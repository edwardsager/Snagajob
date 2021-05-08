'use strict';
if (process.env["NODE_PATH"]) {
    let paths = process.env["NODE_PATH"].split(/:/);
    for (let p of paths) {
        console.log(`Adding path ${p} to module.paths`);
        module.paths.push(p);
    }
}
const http = require("http");
const tracer = require("tracer").console({ transport: function(data) { process.stdout.write(data.output + "\n") }, format: "{{timestamp}} {{file}}:{{line}} {{method}} {{message}}", dateformat: "HH:MM:ss.l", });
const util = require("util");
const fs = require("fs");
const md5 = require("md5");
const mime = require('mime-types');

let staticDir = 'static';

let handler = function(req, res) {
    try {
        let urlDerived = 'http://' + req.headers.host + req.url;
        req.urlParsed = parseURLextended(urlDerived);
        tracer.log(req.urlParsed.path);
        if (req.urlParsed.path == '' || req.urlParsed.path == '/') {
            req.urlParsed.path = '/index.html';
        }
        tracer.log(req.urlParsed.path);
        let staticFullPath = staticDir + req.urlParsed.path;
        tracer.log(staticFullPath);
        if (endpoints[req.urlParsed.path] && typeof endpoints[req.urlParsed.path] == 'function') {
            endpoints[req.urlParsed.path](req, res);
            return;
            // logging here
        } else if (fs.existsSync(staticFullPath)) {
            let contentType = mime.lookup(staticFullPath);
            let stream = fs.createReadStream(staticFullPath);
            stream.on('error', (err) => {
                try {
                    res.setHeader("Content-Type", 'text/plain');
                    res.writeHead(500);
                    res.end(error.message)
                    return;
                } catch (error) {
                    tracer.log(error.message + "\n" + error.stack);
                    //res.writeHead(500);
                    res.end(error.message);
                    return;
                }
            });
            stream.on('close', () => {
                // logging here
            });
            res.setHeader("Content-Type", contentType);
            res.writeHead(200);
            stream.pipe(res);
            return;
        } else {
            res.setHeader("Content-Type", "text/plain");
            res.writeHead(404);
            res.end(JSON.stringify(req.urlParsed, null, 4));
            return;
            //logging here
        }
    } catch (error) {
        tracer.log(error.message + "\n" + error.stack);
        res.setHeader("Content-Type", "text/plain");
        res.writeHead(500);
        res.end(error.message + "\n" + error.stack);
        return;
    }
};

let endpoints = {
    '/api/url': url,
    '/api/employer/login': loginEmployer,
    '/api/jobseeker/login': loginJobSeeker,
}

function url(req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(req.urlParsed, null, 4));
}

function loginEmployer(req, res) {
    let result = { result: 'OK', url: req.urlParsed };
    try {
        if (!req.urlParsed.params.emailAddress.match(/@/)) {
            result.result = 'FAIL';
            result.error = "E-Mail Address doesn't look right, it's missing an @";
        }
    } catch (error) {
        result.result = 'FAIL';
        result.error = error.message;
        result.stack = error.stack;
    }
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(result, null, 4));
}

function loginJobSeeker(req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(req.urlParsed, null, 4));
}

const host = '0.0.0.0';
const port = 80;
let server = http.createServer(handler);
server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});

function parseURLextended(url, origin) {
    try {
        let parsedURLObj = new URL(url, origin);
        //tracer.log(parsedURLObj);
        let parsedURL = {};
        for (let k in parsedURLObj) {
            let temp = parsedURLObj[k];
            if (typeof temp == "string") {
                if (k == "origin") {
                    parsedURL.index = temp.replace(/^http:|https:/, "");
                    parsedURL[k] = temp;
                } else {
                    parsedURL[k] = temp;
                }
            }
        }
        // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
        parsedURL.params = {};
        for (let pair of parsedURLObj.searchParams.entries()) {
            parsedURL.params[pair[0]] = pair[1];
        }
        parsedURL.protocol = parsedURL.protocol.replace(/:/, "");
        let parts = parsedURL.host.split('.');
        let tld = parts.pop().toLowerCase();
        let domain = parts.pop();
        parsedURL.domain = (domain + '.' + tld).toLowerCase();
        if (!parsedURL.pathname || !parsedURL.pathname.length || parsedURL.pathname == '/') { // this is a topLevel link so will save to the domain table too along with ACLs
            parsedURL.topLevel = parsedURL.host;
        }
        let hostParts = parsedURL.host.split('.');
        parsedURL.server = hostParts.shift();
        if (!parsedURL.server.length) { parsedURL.server = '*' }
        parsedURL.subdomain = hostParts.join('.');

        if (parsedURL.search) {
            parsedURL.search = parsedURL.search.replace(/^\?/, '');
        }

        parsedURL.site = parsedURL.host;

        // try to determine the path to this resource. If a resource has an extension indicated by a '.' in name, remove that from path
        if (parsedURL.pathname && parsedURL.pathname != '/' && parsedURL.pathname.length > 1) {
            let pathParts = parsedURL.pathname.split('/');
            if (pathParts.length && pathParts[pathParts.length - 1] && pathParts[pathParts.length - 1].length && pathParts[pathParts.length - 1].match(/\./)) {
                parsedURL.file = pathParts.pop();
                let p = parsedURL.file.split(/\./);
                if (p.length > 1) {
                    parsedURL.extension = p.pop().toLowerCase();
                }
            }
            parsedURL.path = pathParts.join('/');
        }

        // put the ID's in
        parsedURL.url = url;
        // sometimes, parser addes a trailing / which screws up stuff when we just want to try all the differeted top level permutations so we just want the subnitted URL
        // however, if we subit an origin, typically, when getting absolte URL from a link,then we need to use the result href since it is calculated to be the absolute URL
        if (parsedURL.pathname == '/' && !parsedURL.url.match(/\/$/)) {
            parsedURL.path = '';
        } else {
            parsedURL.path = parsedURL.pathname;
        }
        //tracer.log(parsedURL);
        return parsedURL;
    } catch (error) {
        tracer.log(error);
        return error;
    }
}