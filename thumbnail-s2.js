// dependencies
var async = require('async');
var gm = require('gm')
    .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

var express = require('express')
var app = express()
var bodyParser = require('body-parser');

var Minio = require('minio');
//var sharp = require('sharp');
var config = require('config');

var mcConfig = config.get('config');
if (mcConfig.endPoint === '<endpoint>') {
    console.log('Please configure your endpoint in \"config/webhook.json\".');
    process.exit(1);
}

// constants
var MAX_WIDTH  = 450;
var MAX_HEIGHT = 300;

// get reference to S3 client
var s3 = new Minio.Client(mcConfig)

app.use(bodyParser.json()); // for parsing application/json

app.post('/', function (req, res) {
    var event = req.body;

    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    // Reading options from event:
    // {
    //     EventName: 's3:ObjectCreated:Post',
    //         Key: 'salesapiens/salesapiens/avatar/1590880446-1-0002-5468/mini_magick20200530-1-1uk5v45.png',
    //     Records: [
    //     {
    //         eventVersion: '2.0',
    //         eventSource: 'minio:s3',
    //         awsRegion: '',
    //         eventTime: '2020-06-01T15:51:57Z',
    //         eventName: 's3:ObjectCreated:Post',
    //         userIdentity: { principalId: '' },
    //         requestParameters: { accessKey: '', region: '', sourceIPAddress: '81.23.1.1' },
    //         responseElements: {
    //             'x-amz-request-id': '1614765D7F7CC834',
    //             'x-minio-deployment-id': 'dba0aed8-3801-4081-b708-c7b054e283d4',
    //             'x-minio-origin-endpoint': 'http://10.0.1.39:9000'
    //         },
    //         s3: {
    //             s3SchemaVersion: '1.0',
    //             configurationId: 'Config',
    //             bucket: {
    //                 name: 'salesapiens',
    //                 ownerIdentity: { principalId: '' },
    //                 arn: 'arn:aws:s3:::salesapiens'
    //             },
    //             object: {
    //                 key: 'salesapiens%2Favatar%2F1590880446-1-0002-5468%2Fmini_magick20200530-1-1uk5v45.png',
    //                 size: 424739,
    //                 eTag: '0b12eaca61f5644e3e6165c0179b54fb-1',
    //                 contentType: 'image/png',
    //                 userMetadata: { 'content-type': 'image/png' },
    //                 versionId: '1',
    //                 sequencer: '1614765ECEA7FFD0'
    //             }
    //         },
    //         source: {
    //             host: '81.23.1.1',
    //             port: '',
    //             userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/81.0.4044.138 Chrome/81.0.4044.138 Safari/537.36'
    //         }
    //     }
    // ]
    // }

    var srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey    = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    var dstBucket = srcBucket;
    // var dstKey    = srcKey + "_thumb";
    var dstKey    = srcKey.substr(0, srcKey.lastIndexOf(".")) + "_thumb." + srcKey.split('.').pop();
    // Sanity check: validate that source and destination are different buckets.
    /*if (srcBucket == dstBucket) {
        callback("Source and destination buckets are the same.");
        return;
    }*/
    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        console.log("Could not determine the image type.");
        return;
    }
    var imageType = typeMatch[1];
    var lowerImageType = imageType.toLowerCase();
    if (lowerImageType != "jpg" && lowerImageType != "jpeg" && lowerImageType != "bmp" && lowerImageType != "png") {
        console.log('Unsupported image type:  '+imageType);
        return;
    }
    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
            function download(next) {
                // Download the image from S3 into a buffer.
                s3.getObject(srcBucket, srcKey, next);
            },
            function transform(response, next) {
                gm(response.Body)
                    .resize(500)
                    .autoOrient()
                    .command('convert')
                    .out('-quality', 90)
                    .out('-gravity', 'center')
                    .out('-crop', '450x300+0+0')
                    .toBuffer(imageType, function(err, buffer) {
                        if (err) {
                            next(err);
                        } else {
                            next(null, response.ContentType, buffer);
                        }
                    })
                /*gm(response.Body).size(function(err, size) {
                    // Transform the image buffer in memory.
                    this.resize(500)
                                            .autoOrient()
                                            .command('convert')
                                            .out('-quality', 90)
                                            .out('-gravity', 'center')
                                            .out('-crop', '450x300+0+0')
                                            .toBuffer(imageType, function(err, buffer) {
                          if (err) {
                              next(err);
                          } else {
                              next(null, response.ContentType, buffer);
                          }
                      })
                })*/
            },
            function upload(contentType, data, next) {
                // Stream the transformed image to a different S3 bucket.
                s3.putObject(dstBucket,
                    dstKey,
                    data,
                    contentType,
                    next
                );
            }
        ], function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + dstKey
                );
            }

            res.send("");
            //callback(null, "message");
        }
    );
})


var server = app.listen(3000, function () {
    // console.log('Webhook listening on all interfaces at port 3000!')
    // console.log('Please update minio server config as explained in `https://docs.min.io/docs/minio-server-configuration-guide.html` to enable webhook notification target.')
    // console.log(webhookConfig())
    // console.log('Once server config is updated, please restart your minio server.')
    // console.log('')
    // console.log('Now we proceed to use "mc" to enable receiving events over webhook.')
    // console.log('')
    // if ((mcConfig.destBucket) && (mcConfig.bucket)) {
    //     console.log('   $ mc mb myminio/'+mcConfig.bucket)
    //     console.log('   $ mc mb myminio/'+mcConfig.destBucket)
    // }
    // var msg = '   $ mc event add myminio/images arn:minio:sqs:us-east-1:1:webhook --event put'
    // if (mcConfig.prefix) {
    //     msg += ' --prefix ' + mcConfig.prefix
    // }
    // if (mcConfig.suffix) {
    //     msg += ' --suffix ' + mcConfig.suffix
    // }
    // console.log(msg)
})

if (process.platform === "win32") {
    var rl = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on("SIGINT", function () {
        process.emit("SIGINT");
    });
}

process.on("SIGINT", function () {
    // graceful shutdown
    server.close(function () {
        console.log( "Closed out remaining connections.");
        // Close db connections, etc.
    });
    process.exit();
});
