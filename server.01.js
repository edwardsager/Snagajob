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

            // extensively parse the URL and provide convenience variables
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

            // check for the session id in cookies, then look it up , then determine if employer or user
            if (req?.headers?.cookies?.Snagajob_sessionId) {
                let sql = `select person.id as id_person, * from person left outer join employer on person.id_employer = employer.id where person.id_session = '${req.headers.cookies.Snagajob_sessionId}'::uuid`;
                tracer.log(sql);
                let data = await pool.query(sql);
                if (data?.rows?.length) { // found them 
                    req.session = data.rows[0];
                    tracer.log(JSON.stringify(req.session,null,4));
                }
            }

            // redirect when no explicit path specified of session data indicates it
            if (req.urlParsed.path == '' || req.urlParsed.path == '/') {
                if (req?.session?.login_type?.match(/EMPLOYER/)) {
                    req.urlParsed.path = '/employer/listJobs.html';
                    // redirect to full url
                    res.setHeader("Location", req.urlParsed.path);
                    res.writeHead(302);
                    res.end();
                    // logging here
                    resolve();
                    return;
            }
                if (req?.session?.login_type?.match(/JOBSEEKER/)) {
                    req.urlParsed.path = '/jobseeker/searchJobs.html';
                    // redirect to full url
                    res.setHeader("Location", req.urlParsed.path);
                    res.writeHead(302);
                    res.end();
                    // logging here
                    resolve();
                    return;
                }
                else {
                  req.urlParsed.path = '/index.html';
                }
            }
            tracer.log(req.urlParsed.path);
            tracer.log(req.headers);
            let staticFullPath = staticDir + req.urlParsed.path;
            tracer.log(staticFullPath);

            // decide what to do based on the path, first determine if an endpoint, a static resource or else 404 it
            if (endpoints[req.urlParsed.path] && typeof endpoints[req.urlParsed.path] == 'function') {
                // cehck if endpoint function defined in endpoints object
                // if so, call the function and pass req(+enhancements),res from http server
                tracer.log(`Calling endpoint '${req.urlParsed.path}'`);
                await endpoints[req.urlParsed.path](req, res);
                resolve();
                // logging here
                return;
            } else if (fs.existsSync(staticFullPath)) {
                // check if URL path match path/file in static content directory
                let contentType = mime.lookup(staticFullPath);
                let stream = fs.createReadStream(staticFullPath);
                stream.on('error', (err) => {
                    try {
                        res.setHeader("Content-Type", 'text/plain');
                        res.writeHead(500);
                        res.end(error.message)
                        resolve();
                        // logging here
                        return;
                    } catch (error) {
                        tracer.log(error.message + "\n" + error.stack);
                        res.writeHead(500);
                        res.end(error.message);
                        resolve();
                        // logging here
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
                // logging here
                return;
            } else {
                res.setHeader("Content-Type", "text/plain");
                res.writeHead(404);
                res.end(JSON.stringify(req.urlParsed, null, 4));
                resolve();
                //logging here
                return;
            }
        } catch (error) {
            tracer.log(error.message + "\n" + error.stack);
            if (! res.headersSent) {    // might end up here due to error above where header already sent, prevent error being thrown by checking this
                res.setHeader("Content-Type", "text/plain");
                res.writeHead(500);
            }
            res.end(error.message + "\n" + error.stack);
            resolve();
                //logging here
                return;
        }
    });
}

let endpoints = {
    '/api/url': url,
    '/api/session': session,
    '/api/logout': logout,
    '/api/employer/login': loginEmployer,
    '/api/jobseeker/login': loginJobSeeker,
    '/api/employer/listJobs': listJobs,
    '/api/employer/listApplications': listApplications,
    '/api/employer/listJobQuestions': listJobQuestions,
    '/api/jobseeker/searchJobs': searchJobs,
    '/api/jobseeker/applyJob': applyJob,
}

async function session(req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ session:req.session }, null, 4));
    return;
}

async function url(req, res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(req.urlParsed, null, 4));
    return;
}

async function applyJob(req, res) {
    let result = { answers:[], session: req.session, url:req.urlParsed };
    try {
        tracer.log(JSON.stringify(req?.urlParsed?.params,null,4));
        let idJob = req?.urlParsed?.params?.idJob;
        let sql = `select * from jobs where id = '${idJob}'`;
        tracer.log(sql);
        let dataJob = await pool.query(sql);
        tracer.log(JSON.stringify(dataJob.rows,null,4));

        sql = `select * from job_questions where id_job = '${idJob}'`;
        tracer.log(sql);
        let data = await pool.query(sql);
        tracer.log(JSON.stringify(data.rows,null,4))
        // check all questions came in
        let missing = data.rows.length;
        for (let row of data.rows) {
            tracer.log(row.id);
            if (row.id in req?.urlParsed?.params) {
                --missing;
            }
            else {
                tracer.log('not in params');
            }
        }
        if (missing) {
            result.error = `There are ${missing} missing questions from the application`;
            res.setHeader("Content-Type", "application/json");
            res.writeHead(500);
            res.end(JSON.stringify(result, null, 4));
            return;
        }
        // now run all the regexes agains anwers and determine result
        result.finalResult = 'ACCEPTED';
        let answers = {};
        let questions = {};
        for (let row of data.rows) {
            let regex = new RegExp(row.answer_regex,row.regex_flags);
            tracer.log(regex);
            let answer = req?.urlParsed?.params[row.id];
            tracer.log(answer);
            answers[row.id] = answer;
            questions[row.id] = row;
            if (answer.match(regex)) {
                result.answers.push({result:'OK',idQuestion:row.id});
            }
            else {
                result.answers.push({result:'FAIL',idQuestion:row.id});
                result.finalResult = 'REJECTED';
            }
        }
        // save the application
        let save = {
            id:md5(req?.urlParsed?.params?.idPerson+req?.urlParsed?.params?.idJob),
            id_job:req?.urlParsed?.params?.idJob,
            id_person:req?.urlParsed?.params?.idPerson,
            answers:answers,
            questions:questions,
            result:result.finalResult,
            id_employer:dataJob.rows[0].id_employer
        }
        sql = `
            insert into applications (id,id_job,id_person,answers,questions,result,date_applied,id_employer)
            values ($1,$2,$3,$4,$5,$6,now(),$7)
            on conflict(id) do update set date_applied = now(), id_job = $2, id_person = $3, answers = $4, questions = $5, result = $6, id_employer = $7
        `;
        tracer.log(sql);
        let upsert = await pool.query(sql, [save.id,save.id_job,save.id_person,save.answers,save.questions,save.result,save.id_employer]);
        tracer.log(JSON.stringify(upsert,null,4));
    }
    catch(error) {
        result.error = error.message;
        result.stack = error.stack
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500);
        res.end(JSON.stringify(result, null, 4));
        return;
    }
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function logout(req,res) {
    res.setHeader("Set-Cookie", `Snagajob_sessionId=deleted; Domain=.sagers.org; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    let result = { result: 'OK', redirect: '/' };
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function listJobs(req,res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    let result = { result: 'OK', session: req.session };
    let sql = `select * from jobs where id_employer = '${req.session.id_employer}'::uuid`;
    tracer.log(sql);
    let data = await pool.query(sql);
    tracer.log(JSON.stringify(data,null,4))
    if (data?.rows?.length) { // found them 
        result.data = data.rows;
    }
    tracer.log(JSON.stringify(result,null,4))
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function listApplications(req,res) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    let result = { result: 'OK', session: req.session };
    let sql = `
        select applications.*, jobs.title as title, jobs.description as description
        from applications
        left outer join jobs on applications.id_job = jobs.id
        where applications.id_employer = '${req.session.id_employer}'::uuid
    `;
    tracer.log(sql);
    let data = await pool.query(sql);
    tracer.log(JSON.stringify(data,null,4))
    if (data?.rows?.length) { // found them 
        result.data = data.rows;
    }
    tracer.log(JSON.stringify(result,null,4))
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function searchJobs(req,res) {
    let result = { result: 'OK', session: req.session };
    let sql = `select * from jobs`;
    tracer.log(JSON.stringify(req?.urlParsed,null,4));
    if (req?.urlParsed?.params?.query) {
        let query = req.urlParsed.params.query.trim().replace(/\s+/g,'\\s+');
        sql += ` where title ~* '${query}' or description ~* '${query}'`;
    }
    tracer.log(sql);
    let data = await pool.query(sql);
    //tracer.log(JSON.stringify(data,null,4))
    if (data?.rows?.length) { // found them 
        result.data = data.rows;
    }
    //tracer.log(JSON.stringify(result,null,4))
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(result, null, 4));
    return;
}

async function listJobQuestions(req,res) {
    try {
        let result = { result: 'OK', session: req.session };
        let jobId = req?.urlParsed?.params?.idJob;
        let sql = `select * from job_questions where id_job = '${jobId}'::uuid`;
        tracer.log(sql);
        let data = await pool.query(sql);
        tracer.log(JSON.stringify(data,null,4))
        if (data?.rows?.length) { // found them 
            result.data = data.rows;
        }
        result.idJob = req.urlParsed.params.idJob;

        sql = `select * from jobs left outer join employer on jobs.id_employer = employer.id where jobs.id = '${req?.urlParsed?.params?.idJob}'`;
        let dataJ = await pool.query(sql);
        result.dataJob = dataJ.rows[0];

        //tracer.log(JSON.stringify(result,null,4))
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify(result, null, 4));
        return;
    }
    catch(error) {
        //tracer.log(error.message + "\n" + error.stack);
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ result:'FAIL',error:error.message, stack:error.stack },null,4));
        return;
    }
}

async function loginJobSeeker(req, res) {
    tracer.log('loginJobSeeker');
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
            let password = req.urlParsed.params.password.trim();
            let data = await pool.query(`select * from person where person.id = md5('${email}')::uuid`);
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
                    result.redirect = '/jobseeker/searchJobs.html'
                    result.data = data;
                }
            }
            else {
                tracer.log('Job seeker not found');
                result.result = 'NOT FOUND';
                if (email) {
                    result.sessionId = md5(email + (new Date()).toISOString());
                    if (result.sessionId) {
                        res.setHeader("Set-Cookie", `Snagajob_sessionId=${result.sessionId}; Domain=.sagers.org; Path=/; Max-Age=86400;`);
                    }
                    let sql = `
                        insert into person
                        (id,email,password,name_first,name_last,login_type,id_session)
                        values (
                            md5('${email}')::uuid
                            ,'${email}'
                            ,'${password}'
                            ,'${req.urlParsed.params.nameFirst.trim()}'
                            ,'${req.urlParsed.params.nameLast.trim()}'
                            ,'JOBSEEKER'
                            ,'${result.sessionId}'
                        )
                    `;
                    tracer.log(sql);
                    let data = await pool.query(sql);
                    tracer.log(JSON.stringify(data,null,4));
                    if (data.rowCount == 1) {
                        result.redirect = '/jobseeker/searchJobs.html';
                    }
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
            let password = req.urlParsed.params.password.trim();
            let data = await pool.query(`select * from person left outer join employer on person.id_employer = employer.id where person.id = md5('${email}')::uuid`);
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
            else {
                tracer.log('Employer not found');
                result.result = 'NOT FOUND';
                if (email) {
                    result.sessionId = md5(email + (new Date()).toISOString());
                    if (result.sessionId) {
                        res.setHeader("Set-Cookie", `Snagajob_sessionId=${result.sessionId}; Domain=.sagers.org; Path=/; Max-Age=86400;`);
                    }
                    let sql = `
                        insert into person
                        (id,email,password,name_first,name_last,login_type,id_session)
                        values (
                            md5('${email}')::uuid
                            ,'${email}'
                            ,'${password}'
                            ,'${req.urlParsed.params.nameFirst.trim()}'
                            ,'${req.urlParsed.params.nameLast.trim()}'
                            ,'EMPLOYER'
                            ,'${result.sessionId}'
                        )
                    `;
                    tracer.log(sql);
                    let data = await pool.query(sql);
                    tracer.log(JSON.stringify(data,null,4));
                    if (data.rowCount == 1) {
                        result.redirect = '/jobseeker/searchJobs.html';
                    }
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

// define the service
const host = '0.0.0.0';
const port = 80;

let server = http.createServer();
server.on('request', async(req, res) => {
    await handlerPromisified(req, res);
});

server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
