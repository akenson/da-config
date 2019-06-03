const express = require('express'), http = require('http');
const path = require('path');
var Axios = require('axios');               // A Promised base http client
var bodyParser = require('body-parser');    // Receive JSON format
var hash = require('object-hash');
var uuid = require ('uuid/v1');
var app = express();
const perf = require('execution-time')();

app.use(bodyParser.json());
app.use(express.static(__dirname + '/www'));
app.use(bodyParser.urlencoded({extended: true})); 

app.set('port', 3000);
var server = app.listen(app.get('port'), function () {
    console.log('Server listening on port ' + server.address().port);
});

var io = require('socket.io').listen(server);

var FORGE_CLIENT_ID = process.env.FORGE_CLIENT_ID;
var FORGE_CLIENT_SECRET = process.env.FORGE_CLIENT_SECRET;
var FORGE_CALLBACK_HOST = process.env.FORGE_CALLBACK_HOST;
var host_key = hash({'key': FORGE_CALLBACK_HOST}).slice(0, 6);
var access_token = '';
var scopes = 'data:read data:write data:create bucket:create bucket:read code:all';
const querystring = require('querystring');
var objectId = '';
var outputUrl = '';
var result_urn = '';
var wi_res = '';
var wi_resultname = '';
var config_time = ''; // timer for configuration
var result_view_time = ''; // timer for updating the result from configuration in the Forge Viewer

app.get('/api/forge/oauth', function (req, res) {
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/authentication/v1/authenticate',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        data: querystring.stringify({
            client_id: FORGE_CLIENT_ID,
            client_secret: FORGE_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: scopes
        })
    })
        .then(function (response) {
            // Success
            access_token = response.data.access_token;
            console.log(response);
            res.redirect('/api/forge/datamanagement/bucket/create');
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to authenticate');
        });
});

const bucketKey = FORGE_CLIENT_ID.toLowerCase() + '_tutorial_bucket'; // Prefix with your ID so the bucket key is unique across all buckets on all other accounts
const policyKey = 'transient'; // Expires in 24hr

// Route /api/forge/datamanagement/bucket/create
app.get('/api/forge/datamanagement/bucket/create', function (req, res) {
    // Create an application shared bucket using access token from previous route
    // We will use this bucket for storing all files in this tutorial
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'bucketKey': bucketKey,
            'policyKey': policyKey
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/api/forge/datamanagement/bucket/detail');
        })
        .catch(function (error) {
            if (error.response && error.response.status == 409) {
                console.log('Bucket already exists.');
                res.redirect('/api/forge/datamanagement/bucket/detail');
            }
            // Failed
            console.log(error);
            res.send('Failed to create a new bucket');
        });
});

// Route /api/forge/datamanagement/bucket/detail
app.get('/api/forge/datamanagement/bucket/detail', function (req, res) {
    Axios({
        method: 'GET',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/details',
        headers: {
            Authorization: 'Bearer ' + access_token
        }
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/upload.html');
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to verify the new bucket');
        });
});

// For converting the source into a Base64-Encoded string
var Buffer = require('buffer').Buffer;
String.prototype.toBase64 = function () {
    // Buffer is part of Node.js to enable interaction with octet streams in TCP streams, 
    // file system operations, and other contexts.
    var buffer = new Buffer(this).toString('base64');
    buffer = buffer.replace(/\=*$/, '');
    return buffer;
};

var multer = require('multer');         // To handle file upload
var upload = multer({ dest: 'tmp/' }); // Save file into local /tmp folder

// Route /api/forge/datamanagement/bucket/upload
app.post('/api/forge/datamanagement/bucket/upload', upload.single('fileToUpload'), function (req, res) {
    var fs = require('fs'); // Node.js File system for reading files
    objectId =  encodeURIComponent(req.file.originalname);
    fs.readFile(req.file.path, function (err, filecontent) {
        Axios({
            method: 'PUT',
            url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/objects/' + objectId,
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Disposition': 'attachment; filename=\"' + req.file.originalname + "\"",
                'Content-Length': filecontent.length
            },
            data: filecontent
        })
            .then(function (response) {
                // Success
                console.log(response);
                var urn = response.data.objectId.toBase64();
                model_urn = urn;
                //res.redirect('/api/forge/modelderivative/' + urn);
                res.redirect('/api/forge/webhook/initial/' + urn);
            })
            .catch(function (error) {
                // Failed
                console.log(error);
                res.send('Failed to create a new object in the bucket');
            });
    });
});

app.get('/api/forge/webhook/initial/:urn', function(req, res) {
    var urn = req.params.urn;
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/webhooks/v1/systems/derivative/events/extraction.finished/hooks',
        headers: {
            Authorization: 'Bearer ' + access_token,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({
                'callbackUrl': FORGE_CALLBACK_HOST + '/api/forge/viewer/initialready',
                'scope': {
                    'workflow': '' + host_key + '-initial-ready'
                }
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/api/forge/modelderivative/' + urn);
        })
        .catch(function (error) {
            // Failed, web hook already created, just go ahead and create the viewable
            console.log(error);
            res.redirect('/api/forge/modelderivative/' + urn);
        });
});

app.get('/api/forge/webhook/result/:urn', function(req, res) {
    var urn = req.params.urn;
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/webhooks/v1/systems/derivative/events/extraction.finished/hooks',
        headers: {
            Authorization: 'Bearer ' + access_token,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({
                'callbackUrl': FORGE_CALLBACK_HOST + '/api/forge/viewer/resultready',
                'scope': {
                    'workflow': '' + host_key + '-result-ready'
                }
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/api/forge/modelderivative/result/' + urn)
        })
        .catch(function (error) {
            // Failed, web hook already created, just go ahead and create the viewable
            console.log(error);
            res.redirect('/api/forge/modelderivative/result/' + urn);
        });
});

app.get('/api/forge/modelderivative/:urn', function (req, res) {
    var urn = req.params.urn;
    var format_type = 'svf';
    var format_views = ['2d', '3d'];
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/modelderivative/v2/designdata/job',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'input': {
                'urn': urn
            },
            'output': {
                'formats': [
                    {
                        'type': format_type,
                        'views': format_views
                    }
                ]
            },
            'misc': {
                'workflow': host_key + '-initial-ready'
            }
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            console.log("urn: " + urn);
            res.redirect('/viewer.html?urn=' + urn);
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Error at Model Derivative job.');
        });   
});

app.get('/api/forge/modelderivative/result/:urn', function (req, res) {
    perf.start('result_view');
    var format_type = 'svf';
    var format_views = ['2d', '3d'];
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/modelderivative/v2/designdata/job',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'input': {
                'urn': result_urn
            },
            'output': {
                'formats': [
                    {
                        'type': format_type,
                        'views': format_views
                    }
                ]
            },
            'misc': {
                'workflow': host_key + '-result-ready'
              }
        })
    })
        .then(function (response) {
            // Success

            console.log(response);
            console.log("result urn: " + result_urn);
            wi_res.redirect('/viewer.html?urn=' + result_urn);
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            wi_res.send('Error at Model Derivative job.');
        });   
});

// Route /api/forge/oauth/public
app.get('/api/forge/oauth/public', function (req, res) {
    // Limit public token to Viewer read only
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/authentication/v1/authenticate',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        data: querystring.stringify({
            client_id: FORGE_CLIENT_ID,
            client_secret: FORGE_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'viewables:read'
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.json({ access_token: response.data.access_token, expires_in: response.data.expires_in });
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.status(500).json(error);
        });
});

app.post('/api/forge/configure', function (req, res) {    
    var paramname = req.body.paramname;
    var paramvalue = req.body.paramvalue;

    var sign_url = 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURI(bucketKey) + '/objects/' + 
        objectId + '/signed'

    // get signed url from forge dm
    Axios({

        method: 'POST',
        url: sign_url,
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'minutesExpiration': 45,
            'singleUse': false
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/api/forge/workitem/?paramname=' + paramname + "&paramvalue=" + paramvalue + "&signedurl=" + response.data.signedUrl);
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to create signed url for workitem: ' + sign_url);
        });

    console.log("name: " + paramname);
});


app.get('/api/forge/workitem', function (req, res) {
    perf.start('workitem');
    var paramname = req.query.paramname;
    var paramvalue = req.query.paramvalue;
    var signedUrl = req.query.signedurl;
    var result_id = uuid();
    wi_resultname = "Result_" + hash({'id': result_id}) + '.ipt';

    var da_workitem_url = 'https://developer.api.autodesk.com/da/us-east/v3/workitems';
    var activityId = 'Inventor.ChangeParameters+prod';
    outputUrl = 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURI(bucketKey) + '/objects/' + wi_resultname;

    Axios({
        method: 'POST',
        url: da_workitem_url,
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'activityId': activityId,
            'arguments': {
                'InventorDoc': {
                    'url': signedUrl
                },
                'InventorParams': {
                    'url': 'data:application/json,{\"' + paramname + '\": \"' + paramvalue + '\"}'
                },
                'OutputIpt': {
                    'url': outputUrl,
                    'verb': 'put',
                        'headers': {
                            'Authorization': 'Bearer ' + access_token,
                            'Content-type': 'application/octet-stream'
                        }
                },
                'onComplete': {
                    'verb': 'post',
                    'url':  FORGE_CALLBACK_HOST + '/api/forge/workitem/complete'
                }
            }
        })
    })
        .then(function (response) {
            // Success
            var workitemId = response.data.id;
            console.log('workitem processing: ' + workitemId);
            console.log('>> outputUrl: ' + outputUrl);
            io.emit('processing', workitemId);
            wi_res = res;

        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to create workitem');
        });
});

app.post("/api/forge/workitem/complete", function (req, res) {
    const perf_result = perf.stop('workitem');
    config_time = (perf_result.time / 3600).toFixed(2);
    console.log('workitem completed in ' + config_time + ' sec');
    console.log(JSON.stringify(req.body));
    var workitemId = req.body.id;
    var workitemStatus = req.body.status;
    if (workitemStatus === 'success') {
        var result_url = 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURI(bucketKey) + '/objects/' + 
        encodeURI(wi_resultname) + '/details'

        // get signed url from forge dm
        Axios({

            method: 'GET',
            url: result_url,
            headers: {
                Authorization: 'Bearer ' + access_token
            },
             data: JSON.stringify({})
        })
            .then(function (response) {
                // Success
                console.log(response);
                result_urn = response.data.objectId.toBase64();
                res.redirect('/api/forge/webhook/result/' + result_urn);
            })
            .catch(function (error) {
                // Failed
                console.log(error);
                res.send('Failed to create signed url for workitem: ' + sign_url);
            });
    } else {
        res.send('workitem failed: ' + workitemStatus);
    }
});

var last_urn = '';
app.post('/api/forge/viewer/resultready', function (req, res) {
    if (last_urn !== req.body.resourceUrn) {
        last_urn = req.body.resourceUrn;
        var view_result = perf.stop('result_view');
        result_view_time = (view_result.time / 3600).toFixed(2);
        // Update viewer, this is called when the configured result has been translated to SVF
        console.log('webhook called result_urn: ' + req.body.resourceUrn);
        io.emit('update_view', { 'config_time': config_time, 'result_view_time': result_view_time });
    }
});


app.post('/api/forge/viewer/initialready', function (req, res) {
    // Update the viewer, this is called if the input file has been uploaded to OSS but not yet translated to SVF
    console.log('webhook called initial: ' + req.body.resourceUrn);
    io.emit('update_view');
});


// Socket connection for managing two way communication with web pages
io.on('connection', function(socket) {
   console.log("socket connected"); 
});