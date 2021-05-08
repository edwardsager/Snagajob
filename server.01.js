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

const { Pool, Client } = require('pg')
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'Postgres123',
    database: 'snagajob',
})

let staticDir = 'static';

function handlerPromisified(req, res) {
    return new Promise(async(resolve, reject) => {
        try {
            let urlDerived = 'http://' + req.headers.host + req.url;
            req.urlParsed = parseURLextended(urlDerived);
            req.headers.cookies = {};
            let cookieString = req.headers.cookie || '';
            tracer.log(cookieString);
            for (let cookie of cookieString.split(';')) {
                    if (! cookie) { continue }
                    let kv = cookie.split('=');
                    let k = kv.shift().trim();
                    try {
                            let v = decodeURIComponent(kv.join('='));
                            req.headers.cookies[k] = v;
                    }
                    catch (error) {
                            // just keep going
                    }
            }
            tracer.log(JSON.stringify(req.headers.cookies,null,4));
            tracer.log(req.urlParsed.path);
            // check for a session id in cookies, then look it up , then determine if employer or user
            if (req?.headers?.cookies?.Snagajob_sessionId) {
                let sql = `select * from person where id_session = '${req.headers.cookies.Snagajob_sessionId}'::uuid`;
                tracer.log(sql);
                let data = await pool.query(sql);
                if (data?.rows?.length) { // found them 
                    req.session = data.rows[0];
                    tracer.log(JSON.stringify(req.session,null,4));
                }
            }
            if (req.urlParsed.path == '' || req.urlParsed.path == '/') {
                if (req?.session?.login_type?.match(/EMPLOYER/)) {
                    req.urlParsed.path = '/employer/listJobs.html';
                }
                else {
                  req.urlParsed.path = '/index.html';
                }
            }
            tracer.log(req.urlParsed.path);
            tracer.log(req.headers);
            let staticFullPath = staticDir + req.urlParsed.path;
            tracer.log(staticFullPath);
            if (endpoints[req.urlParsed.path] && typeof endpoints[req.urlParsed.path] == 'function') {
                await endpoints[req.urlParsed.path](req, res);
                resolve();
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
                        resolve();
                        return;
                    } catch (error) {
                        tracer.log(error.message + "\n" + error.stack);
                        //res.writeHead(500);
                        res.end(error.message);
                        resolve();
                        return;
                    }
                });
                stream.on('close', () => {
                    // logging here
                });
                res.setHeader("Content-Type", contentType);
                res.writeHead(200);
                stream.pipe(res);
                resolve();
                return;
            } else {
                res.setHeader("Content-Type", "text/plain");
                res.writeHead(404);
                res.end(JSON.stringify(req.urlParsed, null, 4));
                resolve();
                return;
                //logging here
            }
        } catch (error) {
            tracer.log(error.message + "\n" + error.stack);
            res.setHeader("Content-Type", "text/plain");
            res.writeHead(500);
            res.end(error.message + "\n" + error.stack);
            resolve();
            return;
        }
    });
}

let endpoints = {
    '/api/url': url,
    '/api/employer/login': loginEmployer,
    '/api/employer/logout': logoutEmployer,
    '/api/jobseeker/login': loginJobSeeker,
}

async function url(req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(req.urlParsed, null, 4));
    return;
}

async function logoutEmployer(req,res) {
    res.setHeader("Set-Cookie", `Snagajob_sessionId=deleted; Domain=.sagers.org; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    let result = { result: 'OK', redirect: '/' };
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function loginEmployer(req, res) {
    let result = { result: 'OK', url: req.urlParsed, headers: req.headers };
    try {
        if (!req.urlParsed.params.emailAddress.match(/@/)) {
            result.result = 'FAIL';
            result.error = "E-Mail Address doesn't look right, it's missing an @";
        } else if (req.urlParsed.params.emailAddress.trim().match(/\s/)) {
            result.result = 'FAIL';
            result.error = "E-Mail Address doesn't look right, it's got spaces";
        } else if (!req.urlParsed.params.emailAddress.trim().match(/\.com$|\.org$|\.gov|\.edu$$/i)) {
            result.result = 'FAIL';
            result.error = "E-Mail Address doesn't look right, not a .com, .org, .gov or .edu TLD";
        } else { // now lookup in DB
            let email = req.urlParsed.params.emailAddress.trim().toLowerCase();
            let password = req.urlParsed.params.password.trim().toLowerCase();
            let data = await pool.query(`select * from person where id = md5('${email}')::uuid`);
            // check password
            if (data?.rows?.length) { // found them 
                tracer.log(data.rows[0].password);
                if (data.rows[0].password.replace(/-/g, '') != password) {
                    result.result = 'FAIL';
                    result.error = 'Bad password';
                } else {
                    result.sessionId = md5(req.urlParsed.params.emailAddress.trim().toLowerCase() + (new Date()).toISOString());
                    if (result.sessionId) {
                            res.setHeader("Set-Cookie", `Snagajob_sessionId=${result.sessionId}; Domain=.sagers.org; Path=/; Max-Age=86400;`);
                    }
                    res.setHeader("Content-Type", "application/json");
                    await pool.query(`update person set id_session = '${result.sessionId}' where id = md5('${email}')::uuid`);
                    result.result = 'OK';
                    result.redirect = '/employer/listJobs.html'
                    result.data = data;
                }
            }
        }
    } catch (error) {
        result.result = 'FAIL';
        result.error = error.message;
        result.stack = error.stack;
    }
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function loginJobSeeker(req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(req.urlParsed, null, 4));
}

const host = '0.0.0.0';
const port = 80;

let server = http.createServer();
server.on('request', async(req, res) => {
    await handlerPromisified(req, res);
});

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