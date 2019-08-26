# da-config

## Pre-reqs
### Forge App
To get started you first need a Forge App. You can get one here: [Forge](https://forge.autodesk.com)
You'll need your `Client ID` and `Client Secret` values. You'll then set these values as environment variables:
```
FORGE_CLIENT_ID=<your_Forge_Client_ID>
FORGE_CLIENT_SECRET=<your_Forge_Client_Secret>
```

### Webhooks
In order for the callbacks to work you'll need to provide a way for the Forge webhooks to call back to your service. If you're deploying to a publically accessible resrouce get that IP address. If not you'll want to use sme proxy service like [ngrok](https://ngrok.com)

You'll need to add your IP address or hostname for the webhooks as an environment variable:
```
FORGE_CALLBACK_HOST=<your_IP_or_hostname>
```

### node.js
You'll need to install [node.js](https://nodejs.org) since this is a node app

## Getting started
1. Install the node dependencies. At the top level directory:
```
npm install
```
2. Run the node server from the top level directory:
```
node server.js
```
3. If you're running ngrok run it to connect to port 3000
```
ngrok http 3000 -host-header="localhost:3000"
```
*Note:* You'll want to use this address from ngrok in the `FORGE_CALLBACK_HOST` environment variable
4.  Open a web browser and go to:
```
http://localhost:3000
```
