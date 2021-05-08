function ajaxJSON(url, data, callback) {
    var xmlhttp = new XMLHttpRequest();
    let urlGet = url;
    let delim = '?';
    for (var key in data) {
        urlGet += delim + key + '=' + data[key];
        delim = '&';
    }

    xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == XMLHttpRequest.DONE) { // XMLHttpRequest.DONE == 4
            if (xmlhttp.status == 200) {
                var json = {};
                try {
                    var json = JSON.parse(xmlhttp.responseText);
                } catch (error) {
                    json.error = error.message;
                }
                callback(json);
            } else {
                callback({
                    error: 'HTTP status: ' + xmlhttp.status
                })
            }
        }
    };
    xmlhttp.open("GET", urlGet, true);
    xmlhttp.send();
}