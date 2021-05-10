function parseQueryParams() {
    var url=window.location.href;
    var paramString="";
    //console.log(url);
    //fix up the error by Firefox search with #k=
    url = url.replace(/#k=/,'?k=');
    //console.log(url);
    var href=url;
    if(url.match(/\?/)) {
        var temp=url.split("?");
        //console.log(temp);
        // remove the path
        href=temp.shift();
        // reconstruct the parameters in case there was a ? in the string
        paramString=temp.join("?");
    }
    paramString=paramString.trim();

    var params=[];
    //console.log(paramString);
    //var showParams = new Array();
    //console.log(params);
    query={
        href: href,
    };
    if(paramString&&paramString.length) {
        query.paramString=paramString;
        params=decodeURI(paramString).split(/&/);
        //console.log(params);
    }
    var hrefParts=href.split(/\/+/);
    query.PROTOCOL=hrefParts.shift().replace(/:/,"");
    query.SERVER=hrefParts.shift();
    query.PATH=hrefParts.join("/");
    if(query.SERVER.match(/:/)) {
        var serverParts=query.SERVER.split(":");
        query.HOST=serverParts.shift();
        query.PORT=serverParts.shift();
    } else {
        query.HOST=query.SERVER;
    }
    if(params.length) {
        query.params={};
        for(var i in params) {
            var kv=params[i].split(/=/);
            //console.log(kv);
            if(kv.length) {
                var k=kv.shift(); // pull the key off the array so the rest is parameters
                var v=kv.join("="); // in case there was an = in the parameter value
                // decode the value (v)
                if(k.length&&v.length) {
                    query.params[k]=v;
                }
            }
            //if(!k.match(/boeingSession/i)) {
            //	showParams.push(k+"="+v);
            //}
        }
    }
    //console.log(query);
    return query;
}