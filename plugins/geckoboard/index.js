var Check = require('../../models/check');
var request = require('request');
var moment = require('moment');
var momentTz = require('moment-timezone');
var fs = require('fs');
var ejs = require('ejs');
var _ = require('underscore');
var config = require('config').geckoboard;
var API_KEY = process.env.GECKOBOARD_API_KEY;
if (!API_KEY) {
  throw "Missing Geckoboard API key";
}

var template = fs.readFileSync(__dirname + '/views/_detailsEdit.ejs', 'utf8');

function reportStatus(url, status, responseTime, lastDownTimestamp) {
  var statusMessage = status ? "Up" : "Down";
  var downtimeMessage;
  if (lastDownTimestamp) {
    downtimeMessage = momentTz(lastDownTimestamp).tz(config.timezone).format("MMMM D, h:mma");
  }
  var postData = {
    status: statusMessage,
    responseTime: Math.round(responseTime) + "ms",
    downTime: downtimeMessage
  };
  postToGeckoboard(url, postData);
}

function reportAvailability(url, availability) {
  var postData = {
    item: [{ text: "(30 days)", value: availability, prefix: "%" }]
  };
  postToGeckoboard(url, postData);
}

function postToGeckoboard(url, postData) {
  var postObj = { api_key: API_KEY, data: postData };
  request.post(url, { json: true, body: postObj }, function(err,httpResponse,body){
    if (err || httpResponse.statusCode !== 200) {
      console.error("Posting data to geckoboard failed");
      if (err) {
        console.log(err);
      } else {
        console.log("Got reponse code " + httpResponse.statusCode);
        console.log(body);
      }
    } else {
      console.log("geckoboard request succeeded:", url);
    }
  });
}

function reportToGeckoBoard() {
  Check.find({ "pollerParams.geckoboard_options": { $exists : true } }, function(err, checks) {
    if (err) return;
    
    _.each(checks, function(check) {
      var geckoboardOptions = check.getPollerParam("geckoboard_options");
      if (!geckoboardOptions) return;
      
      var availabilityUrl = geckoboardOptions.availability_url;
      if (availabilityUrl) {
        var monthAgo = moment().subtract(30, 'days').toDate();
        var now = new Date();
        check.getAvailabilityInInterval(monthAgo, now, function(err, data){
          if (err) return;
          reportAvailability(availabilityUrl, data.availability*100);
        });
      }
      
      var statusUrl = geckoboardOptions.status_url;
      if (statusUrl && check.qos) {
        var outages = check.qos.outages;
        var lastDowntime, lastDowntimestamp;
        if (outages && geckoboardOptions.send_last_downtime) {
          lastDowntime = check.qos.outages[check.qos.outages.length-1];
          lastDowntimestamp = lastDowntime[2] === 0 ? lastDowntime[0] : null;
        }
        reportStatus(statusUrl, check.isUp, check.qos.responseTime, lastDowntimestamp);
      }
    });
  });
};

exports.initWebApp = function(options) {
  var dashboard = options.dashboard;

  dashboard.on('checkEdit', function(type, check, partial) {
    var geckoboard_options = check.getPollerParam("geckoboard_options") || {};
    partial.push(ejs.render(template, { locals: { check: check, geckoboard_options: geckoboard_options } }));
  });

  dashboard.on('populateFromDirtyCheck', function(checkDocument, dirtyCheck, type) {
    if (!dirtyCheck.geckoboard_options) return;
    checkDocument.setPollerParam('geckoboard_options', dirtyCheck.geckoboard_options);
  });
  setInterval(reportToGeckoBoard, config.reporting_interval * 1000); 
};
