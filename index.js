var _ = require('lodash');
var AWS = require('aws-sdk');
var Readable = require('stream').Readable;
var util = require('util');

var SqsStream = function(opt) {
  Readable.call(this, _.extend(opt, { objectMode: true }));

  this.sqsClient = new AWS.SQS(opt.awsConfig);
  this.messageBuffer = [];

  this.params = _.pick(opt, 'QueueUrl', 'AttributeNames', 'MaxNumberOfMessages', 'VisibilityTimeout', 'WaitTimeSeconds');

};
util.inherits(SqsStream, Readable);

var push = function() {
  while(this.messageBuffer.length > 0) {
    var msg = this.messageBuffer.splice(0, 1)[0];
    this.emit('message', msg);
    this.push(msg);
  };
};

SqsStream.prototype._read = function() {
  var self = this;

  // push all current messages
  push.call(self);

  // if the queue is empty, then kick off a new message request.
  self.sqsClient.receiveMessage(self.params, function(err, data) {
    if (err && err.statusCode != 200) {
      self.emit('error', err);
    }
    else if (data.Messages && data.Messages.length) {
      self.messageBuffer = self.messageBuffer.concat(data.Messages);
      push.call(self);
    }
    else {
      self.push(null);
      self.emit('close');
    }
  });
};

var SqsPlugin = function(namespace) {
  namespace = namespace || 'sqs';

  var options = {};

  this.attach = function(opt) {
    options = opt;

    var self =
    this[namespace] = {

      messageStream: null,

      // reject calls changeMessageVisibility which puts the message back in the queue and makes it available for receive again.
      reject: function(message, callback) {

        return self.messageStream.sqsClient.changeMessageVisibility({
          QueueUrl: options.QueueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: 0
        }, callback);
      },

      // ack calls deleteMessage to remove from the queue.  ack only fires delete which will remove the message from the queue.
      ack: function(message, callback) {

        return self.messageStream.sqsClient.deleteMessage({
          QueueUrl: options.QueueUrl,
          ReceiptHandle: message.ReceiptHandle
        }, callback);
      }

    };

  };

  this.init = function(done) {
    var err = null;
    var self = this[namespace];

    try {
      self.messageStream = new SqsStream(options);
    } catch (e) {
      err = e;
    }

    done(err);
  };
}

module.exports = {
  SqsStream: SqsStream,
  SqsPlugin: SqsPlugin
};