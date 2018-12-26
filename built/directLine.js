"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DirectLine = exports.ConnectionStatus = void 0;

var _objectWithoutProperties2 = _interopRequireDefault(require("@babel/runtime/helpers/objectWithoutProperties"));

var _objectSpread2 = _interopRequireDefault(require("@babel/runtime/helpers/objectSpread"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));

var _BehaviorSubject = require("rxjs/BehaviorSubject");

var _Observable = require("rxjs/Observable");

require("rxjs/add/operator/catch");

require("rxjs/add/operator/combineLatest");

require("rxjs/add/operator/count");

require("rxjs/add/operator/delay");

require("rxjs/add/operator/do");

require("rxjs/add/operator/filter");

require("rxjs/add/operator/map");

require("rxjs/add/operator/mergeMap");

require("rxjs/add/operator/retryWhen");

require("rxjs/add/operator/share");

require("rxjs/add/operator/take");

require("rxjs/add/observable/dom/ajax");

require("rxjs/add/observable/empty");

require("rxjs/add/observable/from");

require("rxjs/add/observable/interval");

require("rxjs/add/observable/of");

require("rxjs/add/observable/throw");

// In order to keep file size down, only import the parts of rxjs that we use
var DIRECT_LINE_VERSION = 'DirectLine/3.0';
// These types are specific to this client library, not to Direct Line 3.0
var ConnectionStatus;
exports.ConnectionStatus = ConnectionStatus;

(function (ConnectionStatus) {
  ConnectionStatus[ConnectionStatus["Uninitialized"] = 0] = "Uninitialized";
  ConnectionStatus[ConnectionStatus["Connecting"] = 1] = "Connecting";
  ConnectionStatus[ConnectionStatus["Online"] = 2] = "Online";
  ConnectionStatus[ConnectionStatus["ExpiredToken"] = 3] = "ExpiredToken";
  ConnectionStatus[ConnectionStatus["FailedToConnect"] = 4] = "FailedToConnect";
  ConnectionStatus[ConnectionStatus["Ended"] = 5] = "Ended";
})(ConnectionStatus || (exports.ConnectionStatus = ConnectionStatus = {}));

var lifetimeRefreshToken = 30 * 60 * 1000;
var intervalRefreshToken = lifetimeRefreshToken / 2;
var timeout = 20 * 1000;
var retries = (lifetimeRefreshToken - intervalRefreshToken) / timeout;
var POLLING_INTERVAL_LOWER_BOUND = 200; //ms

var errorExpiredToken = new Error("expired token");
var errorConversationEnded = new Error("conversation ended");
var errorFailedToConnect = new Error("failed to connect");
var konsole = {
  log: function log(message) {
    var _console;

    for (var _len = arguments.length, optionalParams = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      optionalParams[_key - 1] = arguments[_key];
    }

    if (typeof window !== 'undefined' && window["botchatDebug"] && message) (_console = console).log.apply(_console, [message].concat(optionalParams));
  }
};

var DirectLine =
/*#__PURE__*/
function () {
  //ms
  function DirectLine(options) {
    (0, _classCallCheck2.default)(this, DirectLine);
    (0, _defineProperty2.default)(this, "connectionStatus$", new _BehaviorSubject.BehaviorSubject(ConnectionStatus.Uninitialized));
    (0, _defineProperty2.default)(this, "activity$", void 0);
    (0, _defineProperty2.default)(this, "domain", "https://directline.botframework.com/v3/directline");
    (0, _defineProperty2.default)(this, "webSocket", void 0);
    (0, _defineProperty2.default)(this, "conversationId", void 0);
    (0, _defineProperty2.default)(this, "expiredTokenExhaustion", void 0);
    (0, _defineProperty2.default)(this, "secret", void 0);
    (0, _defineProperty2.default)(this, "token", void 0);
    (0, _defineProperty2.default)(this, "watermark", '');
    (0, _defineProperty2.default)(this, "streamUrl", void 0);
    (0, _defineProperty2.default)(this, "_botAgent", '');
    (0, _defineProperty2.default)(this, "_userAgent", void 0);
    (0, _defineProperty2.default)(this, "referenceGrammarId", void 0);
    (0, _defineProperty2.default)(this, "pollingInterval", 1000);
    (0, _defineProperty2.default)(this, "tokenRefreshSubscription", void 0);
    (0, _defineProperty2.default)(this, "ending", void 0);
    this.secret = options.secret;
    this.token = options.secret || options.token;
    this.webSocket = (options.webSocket === undefined ? true : options.webSocket) && typeof WebSocket !== 'undefined' && WebSocket !== undefined;

    if (options.domain) {
      this.domain = options.domain;
    }

    if (options.conversationId) {
      this.conversationId = options.conversationId;
    }

    if (options.watermark) {
      this.watermark = options.watermark;
    }

    if (options.streamUrl) {
      if (options.token && options.conversationId) {
        this.streamUrl = options.streamUrl;
      } else {
        console.warn('DirectLineJS: streamUrl was ignored: you need to provide a token and a conversationid');
      }
    }

    this._botAgent = this.getBotAgent(options.botAgent);
    var parsedPollingInterval = ~~options.pollingInterval;

    if (parsedPollingInterval < POLLING_INTERVAL_LOWER_BOUND) {
      if (typeof options.pollingInterval !== 'undefined') {
        console.warn("DirectLineJS: provided pollingInterval (".concat(options.pollingInterval, ") is under lower bound (200ms), using default of 1000ms"));
      }
    } else {
      this.pollingInterval = parsedPollingInterval;
    }

    this.expiredTokenExhaustion = this.setConnectionStatusFallback(ConnectionStatus.ExpiredToken, ConnectionStatus.FailedToConnect, 5);
    this.activity$ = (this.webSocket ? this.webSocketActivity$() : this.pollingGetActivity$()).share();
  } // Every time we're about to make a Direct Line REST call, we call this first to see check the current connection status.
  // Either throws an error (indicating an error state) or emits a null, indicating a (presumably) healthy connection


  (0, _createClass2.default)(DirectLine, [{
    key: "checkConnection",
    value: function checkConnection() {
      var _this = this;

      var once = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
      var obs = this.connectionStatus$.flatMap(function (connectionStatus) {
        if (connectionStatus === ConnectionStatus.Uninitialized) {
          _this.connectionStatus$.next(ConnectionStatus.Connecting); //if token and streamUrl are defined it means reconnect has already been done. Skipping it.


          if (_this.token && _this.streamUrl) {
            _this.connectionStatus$.next(ConnectionStatus.Online);

            return _Observable.Observable.of(connectionStatus);
          } else {
            return _this.startConversation().do(function (conversation) {
              _this.conversationId = conversation.conversationId;
              _this.token = _this.secret || conversation.token;
              _this.streamUrl = conversation.streamUrl;
              _this.referenceGrammarId = conversation.referenceGrammarId;
              if (!_this.secret) _this.refreshTokenLoop();

              _this.connectionStatus$.next(ConnectionStatus.Online);
            }, function (error) {
              _this.connectionStatus$.next(ConnectionStatus.FailedToConnect);
            }).map(function (_) {
              return connectionStatus;
            });
          }
        } else {
          return _Observable.Observable.of(connectionStatus);
        }
      }).filter(function (connectionStatus) {
        return connectionStatus != ConnectionStatus.Uninitialized && connectionStatus != ConnectionStatus.Connecting;
      }).flatMap(function (connectionStatus) {
        switch (connectionStatus) {
          case ConnectionStatus.Ended:
            if (_this.ending) return _Observable.Observable.of(connectionStatus);else return _Observable.Observable.throw(errorConversationEnded);

          case ConnectionStatus.FailedToConnect:
            return _Observable.Observable.throw(errorFailedToConnect);

          case ConnectionStatus.ExpiredToken:
            return _Observable.Observable.of(connectionStatus);

          default:
            return _Observable.Observable.of(connectionStatus);
        }
      });
      return once ? obs.take(1) : obs;
    }
  }, {
    key: "setConnectionStatusFallback",
    value: function setConnectionStatusFallback(connectionStatusFrom, connectionStatusTo) {
      var maxAttempts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 5;
      maxAttempts--;
      var attempts = 0;
      var currStatus = null;
      return function (status) {
        if (status === connectionStatusFrom && currStatus === status && attempts >= maxAttempts) {
          attempts = 0;
          return connectionStatusTo;
        }

        attempts++;
        currStatus = status;
        return status;
      };
    }
  }, {
    key: "expiredToken",
    value: function expiredToken() {
      var connectionStatus = this.connectionStatus$.getValue();
      if (connectionStatus != ConnectionStatus.Ended && connectionStatus != ConnectionStatus.FailedToConnect) this.connectionStatus$.next(ConnectionStatus.ExpiredToken);
      var protectedConnectionStatus = this.expiredTokenExhaustion(this.connectionStatus$.getValue());
      this.connectionStatus$.next(protectedConnectionStatus);
    }
  }, {
    key: "startConversation",
    value: function startConversation() {
      //if conversationid is set here, it means we need to call the reconnect api, else it is a new conversation
      var url = this.conversationId ? "".concat(this.domain, "/conversations/").concat(this.conversationId, "?watermark=").concat(this.watermark) : "".concat(this.domain, "/conversations");
      var method = this.conversationId ? "GET" : "POST";
      return _Observable.Observable.ajax({
        method: method,
        url: url,
        timeout: timeout,
        headers: (0, _objectSpread2.default)({
          "Accept": "application/json"
        }, this.commonHeaders())
      }) //      .do(ajaxResponse => konsole.log("conversation ajaxResponse", ajaxResponse.response))
      .map(function (ajaxResponse) {
        return ajaxResponse.response;
      }).retryWhen(function (error$) {
        return (// for now we deem 4xx and 5xx errors as unrecoverable
          // for everything else (timeouts), retry for a while
          error$.mergeMap(function (error) {
            return error.status >= 400 && error.status < 600 ? _Observable.Observable.throw(error) : _Observable.Observable.of(error);
          }).delay(timeout).take(retries)
        );
      });
    }
  }, {
    key: "refreshTokenLoop",
    value: function refreshTokenLoop() {
      var _this2 = this;

      this.tokenRefreshSubscription = _Observable.Observable.interval(intervalRefreshToken).flatMap(function (_) {
        return _this2.refreshToken();
      }).subscribe(function (token) {
        konsole.log("refreshing token", token, "at", new Date());
        _this2.token = token;
      });
    }
  }, {
    key: "refreshToken",
    value: function refreshToken() {
      var _this3 = this;

      return this.checkConnection(true).flatMap(function (_) {
        return _Observable.Observable.ajax({
          method: "POST",
          url: "".concat(_this3.domain, "/tokens/refresh"),
          timeout: timeout,
          headers: (0, _objectSpread2.default)({}, _this3.commonHeaders())
        }).map(function (ajaxResponse) {
          return ajaxResponse.response.token;
        }).retryWhen(function (error$) {
          return error$.mergeMap(function (error) {
            if (error.status === 403) {
              // if the token is expired there's no reason to keep trying
              _this3.expiredToken();

              return _Observable.Observable.throw(error);
            } else if (error.status === 404) {
              // If the bot is gone, we should stop retrying
              return _Observable.Observable.throw(error);
            }

            return _Observable.Observable.of(error);
          }).delay(timeout).take(retries);
        });
      });
    }
  }, {
    key: "reconnect",
    value: function reconnect(conversation) {
      this.token = conversation.token;
      this.streamUrl = conversation.streamUrl;
      if (this.connectionStatus$.getValue() === ConnectionStatus.ExpiredToken) this.connectionStatus$.next(ConnectionStatus.Online);
    }
  }, {
    key: "end",
    value: function end() {
      if (this.tokenRefreshSubscription) this.tokenRefreshSubscription.unsubscribe();
      this.ending = true;
      this.connectionStatus$.next(ConnectionStatus.Ended);
    }
  }, {
    key: "getSessionId",
    value: function getSessionId() {
      var _this4 = this;

      // If we're not connected to the bot, get connected
      // Will throw an error if we are not connected
      konsole.log("getSessionId");
      return this.checkConnection(true).flatMap(function (_) {
        return _Observable.Observable.ajax({
          method: "GET",
          url: "".concat(_this4.domain, "/session/getsessionid"),
          withCredentials: true,
          timeout: timeout,
          headers: (0, _objectSpread2.default)({
            "Content-Type": "application/json"
          }, _this4.commonHeaders())
        }).map(function (ajaxResponse) {
          if (ajaxResponse && ajaxResponse.response && ajaxResponse.response.sessionId) {
            konsole.log("getSessionId response: " + ajaxResponse.response.sessionId);
            return ajaxResponse.response.sessionId;
          }

          return '';
        }).catch(function (error) {
          konsole.log("getSessionId error: " + error.status);
          return _Observable.Observable.of('');
        });
      }).catch(function (error) {
        return _this4.catchExpiredToken(error);
      });
    }
  }, {
    key: "postActivity",
    value: function postActivity(activity) {
      var _this5 = this;

      // Use postMessageWithAttachments for messages with attachments that are local files (e.g. an image to upload)
      // Technically we could use it for *all* activities, but postActivity is much lighter weight
      // So, since WebChat is partially a reference implementation of Direct Line, we implement both.
      if (activity.type === "message" && activity.attachments && activity.attachments.length > 0) return this.postMessageWithAttachments(activity); // If we're not connected to the bot, get connected
      // Will throw an error if we are not connected

      konsole.log("postActivity", activity);
      return this.checkConnection(true).flatMap(function (_) {
        return _Observable.Observable.ajax({
          method: "POST",
          url: "".concat(_this5.domain, "/conversations/").concat(_this5.conversationId, "/activities"),
          body: activity,
          timeout: timeout,
          headers: (0, _objectSpread2.default)({
            "Content-Type": "application/json"
          }, _this5.commonHeaders())
        }).map(function (ajaxResponse) {
          return ajaxResponse.response.id;
        }).catch(function (error) {
          return _this5.catchPostError(error);
        });
      }).catch(function (error) {
        return _this5.catchExpiredToken(error);
      });
    }
  }, {
    key: "postMessageWithAttachments",
    value: function postMessageWithAttachments(_ref) {
      var _this6 = this;

      var attachments = _ref.attachments,
          messageWithoutAttachments = (0, _objectWithoutProperties2.default)(_ref, ["attachments"]);
      var formData; // If we're not connected to the bot, get connected
      // Will throw an error if we are not connected

      return this.checkConnection(true).flatMap(function (_) {
        // To send this message to DirectLine we need to deconstruct it into a "template" activity
        // and one blob for each attachment.
        formData = new FormData();
        formData.append('activity', new Blob([JSON.stringify(messageWithoutAttachments)], {
          type: 'application/vnd.microsoft.activity'
        }));
        return _Observable.Observable.from(attachments || []).flatMap(function (media) {
          return _Observable.Observable.ajax({
            method: "GET",
            url: media.contentUrl,
            responseType: 'arraybuffer'
          }).do(function (ajaxResponse) {
            return formData.append('file', new Blob([ajaxResponse.response], {
              type: media.contentType
            }), media.name);
          });
        }).count();
      }).flatMap(function (_) {
        return _Observable.Observable.ajax({
          method: "POST",
          url: "".concat(_this6.domain, "/conversations/").concat(_this6.conversationId, "/upload?userId=").concat(messageWithoutAttachments.from.id),
          body: formData,
          timeout: timeout,
          headers: (0, _objectSpread2.default)({}, _this6.commonHeaders())
        }).map(function (ajaxResponse) {
          return ajaxResponse.response.id;
        }).catch(function (error) {
          return _this6.catchPostError(error);
        });
      }).catch(function (error) {
        return _this6.catchPostError(error);
      });
    }
  }, {
    key: "catchPostError",
    value: function catchPostError(error) {
      if (error.status === 403) // token has expired (will fall through to return "retry")
        this.expiredToken();else if (error.status >= 400 && error.status < 500) // more unrecoverable errors
        return _Observable.Observable.throw(error);
      return _Observable.Observable.of("retry");
    }
  }, {
    key: "catchExpiredToken",
    value: function catchExpiredToken(error) {
      return error === errorExpiredToken ? _Observable.Observable.of("retry") : _Observable.Observable.throw(error);
    }
  }, {
    key: "pollingGetActivity$",
    value: function pollingGetActivity$() {
      var _this7 = this;

      var poller$ = _Observable.Observable.create(function (subscriber) {
        // A BehaviorSubject to trigger polling. Since it is a BehaviorSubject
        // the first event is produced immediately.
        var trigger$ = new _BehaviorSubject.BehaviorSubject({});
        trigger$.subscribe(function () {
          if (_this7.connectionStatus$.getValue() === ConnectionStatus.Online) {
            var startTimestamp = Date.now();

            _Observable.Observable.ajax({
              headers: (0, _objectSpread2.default)({
                Accept: 'application/json'
              }, _this7.commonHeaders()),
              method: 'GET',
              url: "".concat(_this7.domain, "/conversations/").concat(_this7.conversationId, "/activities?watermark=").concat(_this7.watermark),
              timeout: timeout
            }).subscribe(function (result) {
              subscriber.next(result);
              setTimeout(function () {
                return trigger$.next(null);
              }, Math.max(0, _this7.pollingInterval - Date.now() + startTimestamp));
            }, function (error) {
              switch (error.status) {
                case 403:
                  _this7.connectionStatus$.next(ConnectionStatus.ExpiredToken);

                  setTimeout(function () {
                    return trigger$.next(null);
                  }, _this7.pollingInterval);
                  break;

                case 404:
                  _this7.connectionStatus$.next(ConnectionStatus.Ended);

                  break;

                default:
                  // propagate the error
                  subscriber.error(error);
                  break;
              }
            });
          }
        });
      });

      return this.checkConnection().flatMap(function (_) {
        return poller$.catch(function () {
          return _Observable.Observable.empty();
        }).map(function (ajaxResponse) {
          return ajaxResponse.response;
        }).flatMap(function (activityGroup) {
          return _this7.observableFromActivityGroup(activityGroup);
        });
      });
    }
  }, {
    key: "observableFromActivityGroup",
    value: function observableFromActivityGroup(activityGroup) {
      if (activityGroup.watermark) this.watermark = activityGroup.watermark;
      return _Observable.Observable.from(activityGroup.activities);
    }
  }, {
    key: "webSocketActivity$",
    value: function webSocketActivity$() {
      var _this8 = this;

      return this.checkConnection().flatMap(function (_) {
        return _this8.observableWebSocket() // WebSockets can be closed by the server or the browser. In the former case we need to
        // retrieve a new streamUrl. In the latter case we could first retry with the current streamUrl,
        // but it's simpler just to always fetch a new one.
        .retryWhen(function (error$) {
          return error$.delay(_this8.getRetryDelay()).mergeMap(function (error) {
            return _this8.reconnectToConversation();
          });
        });
      }).flatMap(function (activityGroup) {
        return _this8.observableFromActivityGroup(activityGroup);
      });
    } // Returns the delay duration in milliseconds

  }, {
    key: "getRetryDelay",
    value: function getRetryDelay() {
      return Math.floor(3000 + Math.random() * 12000);
    } // Originally we used Observable.webSocket, but it's fairly opionated  and I ended up writing
    // a lot of code to work around their implemention details. Since WebChat is meant to be a reference
    // implementation, I decided roll the below, where the logic is more purposeful. - @billba

  }, {
    key: "observableWebSocket",
    value: function observableWebSocket() {
      var _this9 = this;

      return _Observable.Observable.create(function (subscriber) {
        konsole.log("creating WebSocket", _this9.streamUrl);
        var ws = new WebSocket(_this9.streamUrl);
        var sub;

        ws.onopen = function (open) {
          konsole.log("WebSocket open", open); // Chrome is pretty bad at noticing when a WebSocket connection is broken.
          // If we periodically ping the server with empty messages, it helps Chrome
          // realize when connection breaks, and close the socket. We then throw an
          // error, and that give us the opportunity to attempt to reconnect.

          sub = _Observable.Observable.interval(timeout).subscribe(function (_) {
            try {
              ws.send("");
            } catch (e) {
              konsole.log("Ping error", e);
            }
          });
        };

        ws.onclose = function (close) {
          konsole.log("WebSocket close", close);
          if (sub) sub.unsubscribe();
          subscriber.error(close);
        };

        ws.onmessage = function (message) {
          return message.data && subscriber.next(JSON.parse(message.data));
        };

        ws.onerror = function (error) {
          konsole.log("WebSocket error", error);
          if (sub) sub.unsubscribe();
          subscriber.error(error);
        }; // This is the 'unsubscribe' method, which is called when this observable is disposed.
        // When the WebSocket closes itself, we throw an error, and this function is eventually called.
        // When the observable is closed first (e.g. when tearing down a WebChat instance) then
        // we need to manually close the WebSocket.


        return function () {
          if (ws.readyState === 0 || ws.readyState === 1) ws.close();
        };
      });
    }
  }, {
    key: "reconnectToConversation",
    value: function reconnectToConversation() {
      var _this10 = this;

      return this.checkConnection(true).flatMap(function (_) {
        return _Observable.Observable.ajax({
          method: "GET",
          url: "".concat(_this10.domain, "/conversations/").concat(_this10.conversationId, "?watermark=").concat(_this10.watermark),
          timeout: timeout,
          headers: (0, _objectSpread2.default)({
            "Accept": "application/json"
          }, _this10.commonHeaders())
        }).do(function (result) {
          if (!_this10.secret) _this10.token = result.response.token;
          _this10.streamUrl = result.response.streamUrl;
        }).map(function (_) {
          return null;
        }).retryWhen(function (error$) {
          return error$.mergeMap(function (error) {
            if (error.status === 403) {
              // token has expired. We can't recover from this here, but the embedding
              // website might eventually call reconnect() with a new token and streamUrl.
              _this10.expiredToken();
            } else if (error.status === 404) {
              return _Observable.Observable.throw(errorConversationEnded);
            }

            return _Observable.Observable.of(error);
          }).delay(timeout).take(retries);
        });
      });
    }
  }, {
    key: "commonHeaders",
    value: function commonHeaders() {
      return {
        "Authorization": "Bearer ".concat(this.token),
        "x-ms-bot-agent": this._botAgent
      };
    }
  }, {
    key: "getBotAgent",
    value: function getBotAgent() {
      var customAgent = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
      var clientAgent = 'directlinejs';

      if (customAgent) {
        clientAgent += "; ".concat(customAgent);
      }

      return "".concat(DIRECT_LINE_VERSION, " (").concat(clientAgent, ")");
    }
  }]);
  return DirectLine;
}();

exports.DirectLine = DirectLine;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9kaXJlY3RMaW5lLnRzIl0sIm5hbWVzIjpbIkRJUkVDVF9MSU5FX1ZFUlNJT04iLCJDb25uZWN0aW9uU3RhdHVzIiwibGlmZXRpbWVSZWZyZXNoVG9rZW4iLCJpbnRlcnZhbFJlZnJlc2hUb2tlbiIsInRpbWVvdXQiLCJyZXRyaWVzIiwiUE9MTElOR19JTlRFUlZBTF9MT1dFUl9CT1VORCIsImVycm9yRXhwaXJlZFRva2VuIiwiRXJyb3IiLCJlcnJvckNvbnZlcnNhdGlvbkVuZGVkIiwiZXJyb3JGYWlsZWRUb0Nvbm5lY3QiLCJrb25zb2xlIiwibG9nIiwibWVzc2FnZSIsIm9wdGlvbmFsUGFyYW1zIiwid2luZG93IiwiY29uc29sZSIsIkRpcmVjdExpbmUiLCJvcHRpb25zIiwiQmVoYXZpb3JTdWJqZWN0IiwiVW5pbml0aWFsaXplZCIsInNlY3JldCIsInRva2VuIiwid2ViU29ja2V0IiwidW5kZWZpbmVkIiwiV2ViU29ja2V0IiwiZG9tYWluIiwiY29udmVyc2F0aW9uSWQiLCJ3YXRlcm1hcmsiLCJzdHJlYW1VcmwiLCJ3YXJuIiwiX2JvdEFnZW50IiwiZ2V0Qm90QWdlbnQiLCJib3RBZ2VudCIsInBhcnNlZFBvbGxpbmdJbnRlcnZhbCIsInBvbGxpbmdJbnRlcnZhbCIsImV4cGlyZWRUb2tlbkV4aGF1c3Rpb24iLCJzZXRDb25uZWN0aW9uU3RhdHVzRmFsbGJhY2siLCJFeHBpcmVkVG9rZW4iLCJGYWlsZWRUb0Nvbm5lY3QiLCJhY3Rpdml0eSQiLCJ3ZWJTb2NrZXRBY3Rpdml0eSQiLCJwb2xsaW5nR2V0QWN0aXZpdHkkIiwic2hhcmUiLCJvbmNlIiwib2JzIiwiY29ubmVjdGlvblN0YXR1cyQiLCJmbGF0TWFwIiwiY29ubmVjdGlvblN0YXR1cyIsIm5leHQiLCJDb25uZWN0aW5nIiwiT25saW5lIiwiT2JzZXJ2YWJsZSIsIm9mIiwic3RhcnRDb252ZXJzYXRpb24iLCJkbyIsImNvbnZlcnNhdGlvbiIsInJlZmVyZW5jZUdyYW1tYXJJZCIsInJlZnJlc2hUb2tlbkxvb3AiLCJlcnJvciIsIm1hcCIsIl8iLCJmaWx0ZXIiLCJFbmRlZCIsImVuZGluZyIsInRocm93IiwidGFrZSIsImNvbm5lY3Rpb25TdGF0dXNGcm9tIiwiY29ubmVjdGlvblN0YXR1c1RvIiwibWF4QXR0ZW1wdHMiLCJhdHRlbXB0cyIsImN1cnJTdGF0dXMiLCJzdGF0dXMiLCJnZXRWYWx1ZSIsInByb3RlY3RlZENvbm5lY3Rpb25TdGF0dXMiLCJ1cmwiLCJtZXRob2QiLCJhamF4IiwiaGVhZGVycyIsImNvbW1vbkhlYWRlcnMiLCJhamF4UmVzcG9uc2UiLCJyZXNwb25zZSIsInJldHJ5V2hlbiIsImVycm9yJCIsIm1lcmdlTWFwIiwiZGVsYXkiLCJ0b2tlblJlZnJlc2hTdWJzY3JpcHRpb24iLCJpbnRlcnZhbCIsInJlZnJlc2hUb2tlbiIsInN1YnNjcmliZSIsIkRhdGUiLCJjaGVja0Nvbm5lY3Rpb24iLCJleHBpcmVkVG9rZW4iLCJ1bnN1YnNjcmliZSIsIndpdGhDcmVkZW50aWFscyIsInNlc3Npb25JZCIsImNhdGNoIiwiY2F0Y2hFeHBpcmVkVG9rZW4iLCJhY3Rpdml0eSIsInR5cGUiLCJhdHRhY2htZW50cyIsImxlbmd0aCIsInBvc3RNZXNzYWdlV2l0aEF0dGFjaG1lbnRzIiwiYm9keSIsImlkIiwiY2F0Y2hQb3N0RXJyb3IiLCJtZXNzYWdlV2l0aG91dEF0dGFjaG1lbnRzIiwiZm9ybURhdGEiLCJGb3JtRGF0YSIsImFwcGVuZCIsIkJsb2IiLCJKU09OIiwic3RyaW5naWZ5IiwiZnJvbSIsIm1lZGlhIiwiY29udGVudFVybCIsInJlc3BvbnNlVHlwZSIsImNvbnRlbnRUeXBlIiwibmFtZSIsImNvdW50IiwicG9sbGVyJCIsImNyZWF0ZSIsInN1YnNjcmliZXIiLCJ0cmlnZ2VyJCIsInN0YXJ0VGltZXN0YW1wIiwibm93IiwiQWNjZXB0IiwicmVzdWx0Iiwic2V0VGltZW91dCIsIk1hdGgiLCJtYXgiLCJlbXB0eSIsImFjdGl2aXR5R3JvdXAiLCJvYnNlcnZhYmxlRnJvbUFjdGl2aXR5R3JvdXAiLCJhY3Rpdml0aWVzIiwib2JzZXJ2YWJsZVdlYlNvY2tldCIsImdldFJldHJ5RGVsYXkiLCJyZWNvbm5lY3RUb0NvbnZlcnNhdGlvbiIsImZsb29yIiwicmFuZG9tIiwid3MiLCJzdWIiLCJvbm9wZW4iLCJvcGVuIiwic2VuZCIsImUiLCJvbmNsb3NlIiwiY2xvc2UiLCJvbm1lc3NhZ2UiLCJkYXRhIiwicGFyc2UiLCJvbmVycm9yIiwicmVhZHlTdGF0ZSIsImN1c3RvbUFnZW50IiwiY2xpZW50QWdlbnQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHQTs7QUFDQTs7QUFJQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUF6QkE7QUEyQkEsSUFBTUEsbUJBQW1CLEdBQUcsZ0JBQTVCO0FBdVRBO0lBRVlDLGdCOzs7V0FBQUEsZ0I7QUFBQUEsRUFBQUEsZ0IsQ0FBQUEsZ0I7QUFBQUEsRUFBQUEsZ0IsQ0FBQUEsZ0I7QUFBQUEsRUFBQUEsZ0IsQ0FBQUEsZ0I7QUFBQUEsRUFBQUEsZ0IsQ0FBQUEsZ0I7QUFBQUEsRUFBQUEsZ0IsQ0FBQUEsZ0I7QUFBQUEsRUFBQUEsZ0IsQ0FBQUEsZ0I7R0FBQUEsZ0IsZ0NBQUFBLGdCOztBQXNCWixJQUFNQyxvQkFBb0IsR0FBRyxLQUFLLEVBQUwsR0FBVSxJQUF2QztBQUNBLElBQU1DLG9CQUFvQixHQUFHRCxvQkFBb0IsR0FBRyxDQUFwRDtBQUNBLElBQU1FLE9BQU8sR0FBRyxLQUFLLElBQXJCO0FBQ0EsSUFBTUMsT0FBTyxHQUFHLENBQUNILG9CQUFvQixHQUFHQyxvQkFBeEIsSUFBZ0RDLE9BQWhFO0FBRUEsSUFBTUUsNEJBQW9DLEdBQUcsR0FBN0MsQyxDQUFrRDs7QUFFbEQsSUFBTUMsaUJBQWlCLEdBQUcsSUFBSUMsS0FBSixDQUFVLGVBQVYsQ0FBMUI7QUFDQSxJQUFNQyxz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QUFJLENBQUNvQixZQUFMO0FBQ0gsYUFKRCxNQUlPLElBQUlqQyxLQUFLLENBQUNhLE1BQU4sS0FBaUIsR0FBckIsRUFBMEI7QUFDN0IscUJBQU9wQix1QkFBV2EsS0FBWCxDQUFpQnhELHNCQUFqQixDQUFQO0FBQ0g7O0FBRUQsbUJBQU8yQyx1QkFBV0MsRUFBWCxDQUFjTSxLQUFkLENBQVA7QUFDSCxXQVhnQixFQVloQjBCLEtBWmdCLENBWVZqRixPQVpVLEVBYWhCOEQsSUFiZ0IsQ0FhWDdELE9BYlcsQ0FBSjtBQUFBLFNBZmpCLENBRE07QUFBQSxPQURILENBQVA7QUFpQ0g7OztvQ0FFdUI7QUFDcEIsYUFBTztBQUNILDBDQUEyQixLQUFLaUIsS0FBaEMsQ0FERztBQUVILDBCQUFrQixLQUFLUztBQUZwQixPQUFQO0FBSUg7OztrQ0FFcUQ7QUFBQSxVQUFsQzBILFdBQWtDLHVFQUFaLEVBQVk7QUFDbEQsVUFBSUMsV0FBVyxHQUFHLGNBQWxCOztBQUVBLFVBQUlELFdBQUosRUFBaUI7QUFDYkMsUUFBQUEsV0FBVyxnQkFBU0QsV0FBVCxDQUFYO0FBQ0g7O0FBRUQsdUJBQVV6SixtQkFBVixlQUFrQzBKLFdBQWxDO0FBQ0giLCJzb3VyY2VzQ29udGVudCI6WyIvLyBJbiBvcmRlciB0byBrZWVwIGZpbGUgc2l6ZSBkb3duLCBvbmx5IGltcG9ydCB0aGUgcGFydHMgb2YgcnhqcyB0aGF0IHdlIHVzZVxuXG5pbXBvcnQgeyBBamF4UmVzcG9uc2UsIEFqYXhSZXF1ZXN0IH0gZnJvbSAncnhqcy9vYnNlcnZhYmxlL2RvbS9BamF4T2JzZXJ2YWJsZSc7XG5pbXBvcnQgeyBCZWhhdmlvclN1YmplY3QgfSBmcm9tICdyeGpzL0JlaGF2aW9yU3ViamVjdCc7XG5pbXBvcnQgeyBPYnNlcnZhYmxlIH0gZnJvbSAncnhqcy9PYnNlcnZhYmxlJztcbmltcG9ydCB7IFN1YnNjcmliZXIgfSBmcm9tICdyeGpzL1N1YnNjcmliZXInO1xuaW1wb3J0IHsgU3Vic2NyaXB0aW9uIH0gZnJvbSAncnhqcy9TdWJzY3JpcHRpb24nO1xuXG5pbXBvcnQgJ3J4anMvYWRkL29wZXJhdG9yL2NhdGNoJztcbmltcG9ydCAncnhqcy9hZGQvb3BlcmF0b3IvY29tYmluZUxhdGVzdCc7XG5pbXBvcnQgJ3J4anMvYWRkL29wZXJhdG9yL2NvdW50JztcbmltcG9ydCAncnhqcy9hZGQvb3BlcmF0b3IvZGVsYXknO1xuaW1wb3J0ICdyeGpzL2FkZC9vcGVyYXRvci9kbyc7XG5pbXBvcnQgJ3J4anMvYWRkL29wZXJhdG9yL2ZpbHRlcic7XG5pbXBvcnQgJ3J4anMvYWRkL29wZXJhdG9yL21hcCc7XG5pbXBvcnQgJ3J4anMvYWRkL29wZXJhdG9yL21lcmdlTWFwJztcbmltcG9ydCAncnhqcy9hZGQvb3BlcmF0b3IvcmV0cnlXaGVuJztcbmltcG9ydCAncnhqcy9hZGQvb3BlcmF0b3Ivc2hhcmUnO1xuaW1wb3J0ICdyeGpzL2FkZC9vcGVyYXRvci90YWtlJztcblxuaW1wb3J0ICdyeGpzL2FkZC9vYnNlcnZhYmxlL2RvbS9hamF4JztcbmltcG9ydCAncnhqcy9hZGQvb2JzZXJ2YWJsZS9lbXB0eSc7XG5pbXBvcnQgJ3J4anMvYWRkL29ic2VydmFibGUvZnJvbSc7XG5pbXBvcnQgJ3J4anMvYWRkL29ic2VydmFibGUvaW50ZXJ2YWwnO1xuaW1wb3J0ICdyeGpzL2FkZC9vYnNlcnZhYmxlL29mJztcbmltcG9ydCAncnhqcy9hZGQvb2JzZXJ2YWJsZS90aHJvdyc7XG5cbmNvbnN0IERJUkVDVF9MSU5FX1ZFUlNJT04gPSAnRGlyZWN0TGluZS8zLjAnO1xuXG5kZWNsYXJlIHZhciBwcm9jZXNzOiB7XG4gICAgYXJjaDogc3RyaW5nO1xuICAgIGVudjoge1xuICAgICAgICBWRVJTSU9OOiBzdHJpbmc7XG4gICAgfTtcbiAgICBwbGF0Zm9ybTogc3RyaW5nO1xuICAgIHJlbGVhc2U6IHN0cmluZztcbiAgICB2ZXJzaW9uOiBzdHJpbmc7XG59O1xuXG4vLyBEaXJlY3QgTGluZSAzLjAgdHlwZXNcblxuZXhwb3J0IGludGVyZmFjZSBDb252ZXJzYXRpb24ge1xuICAgIGNvbnZlcnNhdGlvbklkOiBzdHJpbmcsXG4gICAgdG9rZW46IHN0cmluZyxcbiAgICBlVGFnPzogc3RyaW5nLFxuICAgIHN0cmVhbVVybD86IHN0cmluZyxcbiAgICByZWZlcmVuY2VHcmFtbWFySWQ/OiBzdHJpbmdcbn1cblxuZXhwb3J0IHR5cGUgTWVkaWFUeXBlID0gXCJpbWFnZS9wbmdcIiB8IFwiaW1hZ2UvanBnXCIgfCBcImltYWdlL2pwZWdcIiB8IFwiaW1hZ2UvZ2lmXCIgfCBcImltYWdlL3N2Zyt4bWxcIiB8IFwiYXVkaW8vbXBlZ1wiIHwgXCJhdWRpby9tcDRcIiB8IFwidmlkZW8vbXA0XCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVkaWEge1xuICAgIGNvbnRlbnRUeXBlOiBNZWRpYVR5cGUsXG4gICAgY29udGVudFVybDogc3RyaW5nLFxuICAgIG5hbWU/OiBzdHJpbmcsXG4gICAgdGh1bWJuYWlsVXJsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVW5rbm93bk1lZGlhe1xuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICAgY29udGVudFVybDogc3RyaW5nLFxuICAgIG5hbWU/OiBzdHJpbmcsXG4gICAgdGh1bWJuYWlsVXJsPzogc3RyaW5nXG59XG5cbmV4cG9ydCB0eXBlIENhcmRBY3Rpb25UeXBlcyA9IFwiY2FsbFwiIHwgXCJkb3dubG9hZEZpbGVcInwgXCJpbUJhY2tcIiB8IFwibWVzc2FnZUJhY2tcIiB8IFwib3BlblVybFwiIHwgXCJwbGF5QXVkaW9cIiB8IFwicGxheVZpZGVvXCIgfCBcInBvc3RCYWNrXCIgfCBcInNpZ25pblwiIHwgXCJzaG93SW1hZ2VcIjtcblxuZXhwb3J0IHR5cGUgQ2FyZEFjdGlvbiA9IENhbGxDYXJkQWN0aW9uIHwgRG93bmxvYWRGaWxlQ2FyZEFjdGlvbiB8IElNQmFja0NhcmRBY3Rpb24gfCBNZXNzYWdlQmFja0NhcmRBY3Rpb24gfCBPcGVuVVJMQ2FyZEFjdGlvbiB8IFBsYXlBdWRpb0NhcmRBY3Rpb24gfCBQbGF5VmlkZW9DYXJkQWN0aW9uIHwgUG9zdEJhY2tDYXJkQWN0aW9uIHwgU2lnbkluQ2FyZEFjdGlvbiB8IFNob3dJbWFnZUNhcmRBY3Rpb247XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2FsbENhcmRBY3Rpb24ge1xuICAgIGltYWdlPzogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgdHlwZTogXCJjYWxsXCIsXG4gICAgdmFsdWU6IGFueVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIERvd25sb2FkRmlsZUNhcmRBY3Rpb24ge1xuICAgIGltYWdlPzogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgdHlwZTogXCJkb3dubG9hZEZpbGVcIixcbiAgICB2YWx1ZTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSU1CYWNrQ2FyZEFjdGlvbiB7XG4gICAgaW1hZ2U/OiBzdHJpbmcsXG4gICAgdGl0bGU/OiBzdHJpbmcsXG4gICAgdHlwZTogXCJpbUJhY2tcIixcbiAgICB2YWx1ZTogc3RyaW5nXG59XG5cbmV4cG9ydCB0eXBlIE1lc3NhZ2VCYWNrQ2FyZEFjdGlvbiA9IE1lc3NhZ2VCYWNrV2l0aEltYWdlIHwgTWVzc2FnZUJhY2tXaXRoVGl0bGVcblxuZXhwb3J0IGludGVyZmFjZSBNZXNzYWdlQmFja1dpdGhJbWFnZSB7XG4gICAgZGlzcGxheVRleHQ/OiBzdHJpbmcsXG4gICAgaW1hZ2U6IHN0cmluZyxcbiAgICB0ZXh0Pzogc3RyaW5nLFxuICAgIHRpdGxlPzogc3RyaW5nLFxuICAgIHR5cGU6IFwibWVzc2FnZUJhY2tcIixcbiAgICB2YWx1ZT86IGFueVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lc3NhZ2VCYWNrV2l0aFRpdGxlIHtcbiAgICBkaXNwbGF5VGV4dD86IHN0cmluZyxcbiAgICBpbWFnZT86IHN0cmluZyxcbiAgICB0ZXh0Pzogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgdHlwZTogXCJtZXNzYWdlQmFja1wiLFxuICAgIHZhbHVlPzogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT3BlblVSTENhcmRBY3Rpb24ge1xuICAgIGltYWdlPzogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgdHlwZTogXCJvcGVuVXJsXCIsXG4gICAgdmFsdWU6IGFueVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsYXlBdWRpb0NhcmRBY3Rpb24ge1xuICAgIGltYWdlPzogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgdHlwZTogXCJwbGF5QXVkaW9cIixcbiAgICB2YWx1ZTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxheVZpZGVvQ2FyZEFjdGlvbiB7XG4gICAgaW1hZ2U/OiBzdHJpbmcsXG4gICAgdGl0bGU6IHN0cmluZyxcbiAgICB0eXBlOiBcInBsYXlWaWRlb1wiLFxuICAgIHZhbHVlOiBhbnlcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQb3N0QmFja0NhcmRBY3Rpb24ge1xuICAgIGltYWdlPzogc3RyaW5nLFxuICAgIHRpdGxlPzogc3RyaW5nLFxuICAgIHR5cGU6IFwicG9zdEJhY2tcIixcbiAgICB2YWx1ZTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2hvd0ltYWdlQ2FyZEFjdGlvbiB7XG4gICAgaW1hZ2U/OiBzdHJpbmcsXG4gICAgdGl0bGU6IHN0cmluZyxcbiAgICB0eXBlOiBcInNob3dJbWFnZVwiLFxuICAgIHZhbHVlOiBhbnlcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTaWduSW5DYXJkQWN0aW9uIHtcbiAgICBpbWFnZT86IHN0cmluZyxcbiAgICB0aXRsZTogc3RyaW5nLFxuICAgIHR5cGU6IFwic2lnbmluXCIsXG4gICAgdmFsdWU6IGFueVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENhcmRJbWFnZSB7XG4gICAgYWx0Pzogc3RyaW5nLFxuICAgIHVybDogc3RyaW5nLFxuICAgIHRhcD86IENhcmRBY3Rpb25cbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZXJvQ2FyZCB7XG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vdm5kLm1pY3Jvc29mdC5jYXJkLmhlcm9cIixcbiAgICBjb250ZW50OiB7XG4gICAgICAgIHRpdGxlPzogc3RyaW5nLFxuICAgICAgICBzdWJ0aXRsZT86IHN0cmluZyxcbiAgICAgICAgdGV4dD86IHN0cmluZyxcbiAgICAgICAgaW1hZ2VzPzogQ2FyZEltYWdlW10sXG4gICAgICAgIGJ1dHRvbnM/OiBDYXJkQWN0aW9uW10sXG4gICAgICAgIHRhcD86IENhcmRBY3Rpb25cbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVGh1bWJuYWlsIHtcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi92bmQubWljcm9zb2Z0LmNhcmQudGh1bWJuYWlsXCIsXG4gICAgY29udGVudDoge1xuICAgICAgICB0aXRsZT86IHN0cmluZyxcbiAgICAgICAgc3VidGl0bGU/OiBzdHJpbmcsXG4gICAgICAgIHRleHQ/OiBzdHJpbmcsXG4gICAgICAgIGltYWdlcz86IENhcmRJbWFnZVtdLFxuICAgICAgICBidXR0b25zPzogQ2FyZEFjdGlvbltdLFxuICAgICAgICB0YXA/OiBDYXJkQWN0aW9uXG4gICAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNpZ25pbiB7XG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vdm5kLm1pY3Jvc29mdC5jYXJkLnNpZ25pblwiLFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgdGV4dD86IHN0cmluZyxcbiAgICAgICAgYnV0dG9ucz86IENhcmRBY3Rpb25bXVxuICAgIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBPQXV0aCB7XG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vdm5kLm1pY3Jvc29mdC5jYXJkLm9hdXRoXCIsXG4gICAgY29udGVudDoge1xuICAgICAgICB0ZXh0Pzogc3RyaW5nLFxuICAgICAgICBjb25uZWN0aW9ubmFtZTogc3RyaW5nLFxuICAgICAgICBidXR0b25zPzogQ2FyZEFjdGlvbltdXG4gICAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlY2VpcHRJdGVtIHtcbiAgICB0aXRsZT86IHN0cmluZyxcbiAgICBzdWJ0aXRsZT86IHN0cmluZyxcbiAgICB0ZXh0Pzogc3RyaW5nLFxuICAgIGltYWdlPzogQ2FyZEltYWdlLFxuICAgIHByaWNlPzogc3RyaW5nLFxuICAgIHF1YW50aXR5Pzogc3RyaW5nLFxuICAgIHRhcD86IENhcmRBY3Rpb25cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZWNlaXB0IHtcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi92bmQubWljcm9zb2Z0LmNhcmQucmVjZWlwdFwiLFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgdGl0bGU/OiBzdHJpbmcsXG4gICAgICAgIGZhY3RzPzogeyBrZXk6IHN0cmluZywgdmFsdWU6IHN0cmluZyB9W10sXG4gICAgICAgIGl0ZW1zPzogUmVjZWlwdEl0ZW1bXSxcbiAgICAgICAgdGFwPzogQ2FyZEFjdGlvbixcbiAgICAgICAgdGF4Pzogc3RyaW5nLFxuICAgICAgICB2YXQ/OiBzdHJpbmcsXG4gICAgICAgIHRvdGFsPzogc3RyaW5nLFxuICAgICAgICBidXR0b25zPzogQ2FyZEFjdGlvbltdXG4gICAgfVxufVxuXG4vLyBEZXByZWNhdGVkIGZvcm1hdCBmb3IgU2t5cGUgY2hhbm5lbHMuIEZvciB0ZXN0aW5nIGxlZ2FjeSBib3RzIGluIEVtdWxhdG9yIG9ubHkuXG5leHBvcnQgaW50ZXJmYWNlIEZsZXhDYXJkIHtcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi92bmQubWljcm9zb2Z0LmNhcmQuZmxleFwiLFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgdGl0bGU/OiBzdHJpbmcsXG4gICAgICAgIHN1YnRpdGxlPzogc3RyaW5nLFxuICAgICAgICB0ZXh0Pzogc3RyaW5nLFxuICAgICAgICBpbWFnZXM/OiBDYXJkSW1hZ2VbXSxcbiAgICAgICAgYnV0dG9ucz86IENhcmRBY3Rpb25bXSxcbiAgICAgICAgYXNwZWN0Pzogc3RyaW5nXG4gICAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEF1ZGlvQ2FyZCB7XG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vdm5kLm1pY3Jvc29mdC5jYXJkLmF1ZGlvXCIsXG4gICAgY29udGVudDoge1xuICAgICAgICB0aXRsZT86IHN0cmluZyxcbiAgICAgICAgc3VidGl0bGU/OiBzdHJpbmcsXG4gICAgICAgIHRleHQ/OiBzdHJpbmcsXG4gICAgICAgIG1lZGlhPzogeyB1cmw6IHN0cmluZywgcHJvZmlsZT86IHN0cmluZyB9W10sXG4gICAgICAgIGJ1dHRvbnM/OiBDYXJkQWN0aW9uW10sXG4gICAgICAgIGF1dG9sb29wPzogYm9vbGVhbixcbiAgICAgICAgYXV0b3N0YXJ0PzogYm9vbGVhblxuICAgIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBWaWRlb0NhcmQge1xuICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL3ZuZC5taWNyb3NvZnQuY2FyZC52aWRlb1wiLFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgdGl0bGU/OiBzdHJpbmcsXG4gICAgICAgIHN1YnRpdGxlPzogc3RyaW5nLFxuICAgICAgICB0ZXh0Pzogc3RyaW5nLFxuICAgICAgICBtZWRpYT86IHsgdXJsOiBzdHJpbmcsIHByb2ZpbGU/OiBzdHJpbmcgfVtdLFxuICAgICAgICBidXR0b25zPzogQ2FyZEFjdGlvbltdLFxuICAgICAgICBpbWFnZT86IHsgdXJsOiBzdHJpbmcsIGFsdD86IHN0cmluZyB9LFxuICAgICAgICBhdXRvbG9vcD86IGJvb2xlYW4sXG4gICAgICAgIGF1dG9zdGFydD86IGJvb2xlYW5cbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWRhcHRpdmVDYXJkIHtcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi92bmQubWljcm9zb2Z0LmNhcmQuYWRhcHRpdmVcIixcbiAgICBjb250ZW50OiBhbnk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5pbWF0aW9uQ2FyZCB7XG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vdm5kLm1pY3Jvc29mdC5jYXJkLmFuaW1hdGlvblwiLFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgICAgdGl0bGU/OiBzdHJpbmcsXG4gICAgICAgIHN1YnRpdGxlPzogc3RyaW5nLFxuICAgICAgICB0ZXh0Pzogc3RyaW5nLFxuICAgICAgICBtZWRpYT86IHsgdXJsOiBzdHJpbmcsIHByb2ZpbGU/OiBzdHJpbmcgfVtdLFxuICAgICAgICBidXR0b25zPzogQ2FyZEFjdGlvbltdLFxuICAgICAgICBpbWFnZT86IHsgdXJsOiBzdHJpbmcsIGFsdD86IHN0cmluZyB9LFxuICAgICAgICBhdXRvbG9vcD86IGJvb2xlYW4sXG4gICAgICAgIGF1dG9zdGFydD86IGJvb2xlYW5cbiAgICB9XG59XG5cbmV4cG9ydCB0eXBlIEtub3duTWVkaWEgPSBNZWRpYSB8IEhlcm9DYXJkIHwgVGh1bWJuYWlsIHwgU2lnbmluIHwgT0F1dGggfCBSZWNlaXB0IHwgQXVkaW9DYXJkIHwgVmlkZW9DYXJkIHwgQW5pbWF0aW9uQ2FyZCB8IEZsZXhDYXJkIHwgQWRhcHRpdmVDYXJkO1xuZXhwb3J0IHR5cGUgQXR0YWNobWVudCA9IEtub3duTWVkaWEgfCBVbmtub3duTWVkaWE7XG5cbmV4cG9ydCB0eXBlIFVzZXJSb2xlID0gXCJib3RcIiB8IFwiY2hhbm5lbFwiIHwgXCJ1c2VyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVXNlciB7XG4gICAgaWQ6IHN0cmluZyxcbiAgICBuYW1lPzogc3RyaW5nLFxuICAgIGljb25Vcmw/OiBzdHJpbmcsXG4gICAgcm9sZT86IFVzZXJSb2xlXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUFjdGl2aXR5IHtcbiAgICB0eXBlOiBzdHJpbmcsXG4gICAgY2hhbm5lbERhdGE/OiBhbnksXG4gICAgY2hhbm5lbElkPzogc3RyaW5nLFxuICAgIGNvbnZlcnNhdGlvbj86IHsgaWQ6IHN0cmluZyB9LFxuICAgIGVUYWc/OiBzdHJpbmcsXG4gICAgZnJvbTogVXNlcixcbiAgICBpZD86IHN0cmluZyxcbiAgICB0aW1lc3RhbXA/OiBzdHJpbmdcbn1cblxuZXhwb3J0IHR5cGUgQXR0YWNobWVudExheW91dCA9IFwibGlzdFwiIHwgXCJjYXJvdXNlbFwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE1lc3NhZ2UgZXh0ZW5kcyBJQWN0aXZpdHkge1xuICAgIHR5cGU6IFwibWVzc2FnZVwiLFxuICAgIHRleHQ/OiBzdHJpbmcsXG4gICAgbG9jYWxlPzogc3RyaW5nLFxuICAgIHRleHRGb3JtYXQ/OiBcInBsYWluXCIgfCBcIm1hcmtkb3duXCIgfCBcInhtbFwiLFxuICAgIGF0dGFjaG1lbnRMYXlvdXQ/OiBBdHRhY2htZW50TGF5b3V0LFxuICAgIGF0dGFjaG1lbnRzPzogQXR0YWNobWVudFtdLFxuICAgIGVudGl0aWVzPzogYW55W10sXG4gICAgc3VnZ2VzdGVkQWN0aW9ucz86IHsgYWN0aW9uczogQ2FyZEFjdGlvbltdLCB0bz86IHN0cmluZ1tdIH0sXG4gICAgc3BlYWs/OiBzdHJpbmcsXG4gICAgaW5wdXRIaW50Pzogc3RyaW5nLFxuICAgIHZhbHVlPzogb2JqZWN0XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHlwaW5nIGV4dGVuZHMgSUFjdGl2aXR5IHtcbiAgICB0eXBlOiBcInR5cGluZ1wiXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXZlbnRBY3Rpdml0eSBleHRlbmRzIElBY3Rpdml0eSB7XG4gICAgdHlwZTogXCJldmVudFwiLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogYW55XG59XG5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5ID0gTWVzc2FnZSB8IFR5cGluZyB8IEV2ZW50QWN0aXZpdHk7XG5cbmludGVyZmFjZSBBY3Rpdml0eUdyb3VwIHtcbiAgICBhY3Rpdml0aWVzOiBBY3Rpdml0eVtdLFxuICAgIHdhdGVybWFyazogc3RyaW5nXG59XG5cbi8vIFRoZXNlIHR5cGVzIGFyZSBzcGVjaWZpYyB0byB0aGlzIGNsaWVudCBsaWJyYXJ5LCBub3QgdG8gRGlyZWN0IExpbmUgMy4wXG5cbmV4cG9ydCBlbnVtIENvbm5lY3Rpb25TdGF0dXMge1xuICAgIFVuaW5pdGlhbGl6ZWQsICAgICAgICAgICAgICAvLyB0aGUgc3RhdHVzIHdoZW4gdGhlIERpcmVjdExpbmUgb2JqZWN0IGlzIGZpcnN0IGNyZWF0ZWQvY29uc3RydWN0ZWRcbiAgICBDb25uZWN0aW5nLCAgICAgICAgICAgICAgICAgLy8gY3VycmVudGx5IHRyeWluZyB0byBjb25uZWN0IHRvIHRoZSBjb252ZXJzYXRpb25cbiAgICBPbmxpbmUsICAgICAgICAgICAgICAgICAgICAgLy8gc3VjY2Vzc2Z1bGx5IGNvbm5lY3RlZCB0byB0aGUgY29udmVyc3RhaW9uLiBDb25uZWN0aW9uIGlzIGhlYWx0aHkgc28gZmFyIGFzIHdlIGtub3cuXG4gICAgRXhwaXJlZFRva2VuLCAgICAgICAgICAgICAgIC8vIGxhc3Qgb3BlcmF0aW9uIGVycm9yZWQgb3V0IHdpdGggYW4gZXhwaXJlZCB0b2tlbi4gUG9zc2libHkgd2FpdGluZyBmb3Igc29tZW9uZSB0byBzdXBwbHkgYSBuZXcgb25lLlxuICAgIEZhaWxlZFRvQ29ubmVjdCwgICAgICAgICAgICAvLyB0aGUgaW5pdGlhbCBhdHRlbXB0IHRvIGNvbm5lY3QgdG8gdGhlIGNvbnZlcnNhdGlvbiBmYWlsZWQuIE5vIHJlY292ZXJ5IHBvc3NpYmxlLlxuICAgIEVuZGVkICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgYm90IGVuZGVkIHRoZSBjb252ZXJzYXRpb25cbn1cblxuZXhwb3J0IGludGVyZmFjZSBEaXJlY3RMaW5lT3B0aW9ucyB7XG4gICAgc2VjcmV0Pzogc3RyaW5nLFxuICAgIHRva2VuPzogc3RyaW5nLFxuICAgIGNvbnZlcnNhdGlvbklkPzogc3RyaW5nLFxuICAgIHdhdGVybWFyaz86IHN0cmluZyxcbiAgICBkb21haW4/OiBzdHJpbmcsXG4gICAgd2ViU29ja2V0PzogYm9vbGVhbixcbiAgICBwb2xsaW5nSW50ZXJ2YWw/OiBudW1iZXIsXG4gICAgc3RyZWFtVXJsPzogc3RyaW5nLFxuICAgIC8vIEF0dGFjaGVkIHRvIGFsbCByZXF1ZXN0cyB0byBpZGVudGlmeSByZXF1ZXN0aW5nIGFnZW50LlxuICAgIGJvdEFnZW50Pzogc3RyaW5nXG59XG5cbmNvbnN0IGxpZmV0aW1lUmVmcmVzaFRva2VuID0gMzAgKiA2MCAqIDEwMDA7XG5jb25zdCBpbnRlcnZhbFJlZnJlc2hUb2tlbiA9IGxpZmV0aW1lUmVmcmVzaFRva2VuIC8gMjtcbmNvbnN0IHRpbWVvdXQgPSAyMCAqIDEwMDA7XG5jb25zdCByZXRyaWVzID0gKGxpZmV0aW1lUmVmcmVzaFRva2VuIC0gaW50ZXJ2YWxSZWZyZXNoVG9rZW4pIC8gdGltZW91dDtcblxuY29uc3QgUE9MTElOR19JTlRFUlZBTF9MT1dFUl9CT1VORDogbnVtYmVyID0gMjAwOyAvL21zXG5cbmNvbnN0IGVycm9yRXhwaXJlZFRva2VuID0gbmV3IEVycm9yKFwiZXhwaXJlZCB0b2tlblwiKTtcbmNvbnN0IGVycm9yQ29udmVyc2F0aW9uRW5kZWQgPSBuZXcgRXJyb3IoXCJjb252ZXJzYXRpb24gZW5kZWRcIik7XG5jb25zdCBlcnJvckZhaWxlZFRvQ29ubmVjdCA9IG5ldyBFcnJvcihcImZhaWxlZCB0byBjb25uZWN0XCIpO1xuXG5jb25zdCBrb25zb2xlID0ge1xuICAgIGxvZzogKG1lc3NhZ2U/OiBhbnksIC4uLiBvcHRpb25hbFBhcmFtczogYW55W10pID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmICh3aW5kb3cgYXMgYW55KVtcImJvdGNoYXREZWJ1Z1wiXSAmJiBtZXNzYWdlKVxuICAgICAgICAgICAgY29uc29sZS5sb2cobWVzc2FnZSwgLi4uIG9wdGlvbmFsUGFyYW1zKTtcbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUJvdENvbm5lY3Rpb24ge1xuICAgIGNvbm5lY3Rpb25TdGF0dXMkOiBCZWhhdmlvclN1YmplY3Q8Q29ubmVjdGlvblN0YXR1cz4sXG4gICAgYWN0aXZpdHkkOiBPYnNlcnZhYmxlPEFjdGl2aXR5PixcbiAgICBlbmQoKTogdm9pZCxcbiAgICByZWZlcmVuY2VHcmFtbWFySWQ/OiBzdHJpbmcsXG4gICAgcG9zdEFjdGl2aXR5KGFjdGl2aXR5OiBBY3Rpdml0eSk6IE9ic2VydmFibGU8c3RyaW5nPixcbiAgICBnZXRTZXNzaW9uSWQ/IDogKCkgPT4gT2JzZXJ2YWJsZTxzdHJpbmc+XG59XG5cbmV4cG9ydCBjbGFzcyBEaXJlY3RMaW5lIGltcGxlbWVudHMgSUJvdENvbm5lY3Rpb24ge1xuICAgIHB1YmxpYyBjb25uZWN0aW9uU3RhdHVzJCA9IG5ldyBCZWhhdmlvclN1YmplY3QoQ29ubmVjdGlvblN0YXR1cy5VbmluaXRpYWxpemVkKTtcbiAgICBwdWJsaWMgYWN0aXZpdHkkOiBPYnNlcnZhYmxlPEFjdGl2aXR5PjtcblxuICAgIHByaXZhdGUgZG9tYWluID0gXCJodHRwczovL2RpcmVjdGxpbmUuYm90ZnJhbWV3b3JrLmNvbS92My9kaXJlY3RsaW5lXCI7XG4gICAgcHJpdmF0ZSB3ZWJTb2NrZXQ6IGJvb2xlYW47XG5cbiAgICBwcml2YXRlIGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7XG4gICAgcHJpdmF0ZSBleHBpcmVkVG9rZW5FeGhhdXN0aW9uOiBGdW5jdGlvbjtcbiAgICBwcml2YXRlIHNlY3JldDogc3RyaW5nO1xuICAgIHByaXZhdGUgdG9rZW46IHN0cmluZztcbiAgICBwcml2YXRlIHdhdGVybWFyayA9ICcnO1xuICAgIHByaXZhdGUgc3RyZWFtVXJsOiBzdHJpbmc7XG4gICAgcHJpdmF0ZSBfYm90QWdlbnQgPSAnJztcbiAgICBwcml2YXRlIF91c2VyQWdlbnQ6IHN0cmluZztcbiAgICBwdWJsaWMgcmVmZXJlbmNlR3JhbW1hcklkOiBzdHJpbmc7XG5cbiAgICBwcml2YXRlIHBvbGxpbmdJbnRlcnZhbDogbnVtYmVyID0gMTAwMDsgLy9tc1xuXG4gICAgcHJpdmF0ZSB0b2tlblJlZnJlc2hTdWJzY3JpcHRpb246IFN1YnNjcmlwdGlvbjtcblxuICAgIHByaXZhdGUgZW5kaW5nOiBib29sZWFuO1xuXG4gICAgY29uc3RydWN0b3Iob3B0aW9uczogRGlyZWN0TGluZU9wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5zZWNyZXQgPSBvcHRpb25zLnNlY3JldDtcbiAgICAgICAgdGhpcy50b2tlbiA9IG9wdGlvbnMuc2VjcmV0IHx8IG9wdGlvbnMudG9rZW47XG4gICAgICAgIHRoaXMud2ViU29ja2V0ID0gKG9wdGlvbnMud2ViU29ja2V0ID09PSB1bmRlZmluZWQgPyB0cnVlIDogb3B0aW9ucy53ZWJTb2NrZXQpICYmIHR5cGVvZiBXZWJTb2NrZXQgIT09ICd1bmRlZmluZWQnICYmIFdlYlNvY2tldCAhPT0gdW5kZWZpbmVkO1xuXG4gICAgICAgIGlmIChvcHRpb25zLmRvbWFpbikge1xuICAgICAgICAgICAgdGhpcy5kb21haW4gPSBvcHRpb25zLmRvbWFpbjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChvcHRpb25zLmNvbnZlcnNhdGlvbklkKSB7XG4gICAgICAgICAgICB0aGlzLmNvbnZlcnNhdGlvbklkID0gb3B0aW9ucy5jb252ZXJzYXRpb25JZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChvcHRpb25zLndhdGVybWFyaykge1xuICAgICAgICAgICAgdGhpcy53YXRlcm1hcmsgPSAgb3B0aW9ucy53YXRlcm1hcms7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAob3B0aW9ucy5zdHJlYW1VcmwpIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zLnRva2VuICYmIG9wdGlvbnMuY29udmVyc2F0aW9uSWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0cmVhbVVybCA9IG9wdGlvbnMuc3RyZWFtVXJsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ0RpcmVjdExpbmVKUzogc3RyZWFtVXJsIHdhcyBpZ25vcmVkOiB5b3UgbmVlZCB0byBwcm92aWRlIGEgdG9rZW4gYW5kIGEgY29udmVyc2F0aW9uaWQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2JvdEFnZW50ID0gdGhpcy5nZXRCb3RBZ2VudChvcHRpb25zLmJvdEFnZW50KTtcblxuICAgICAgICBjb25zdCBwYXJzZWRQb2xsaW5nSW50ZXJ2YWwgPSB+fm9wdGlvbnMucG9sbGluZ0ludGVydmFsO1xuXG4gICAgICAgIGlmIChwYXJzZWRQb2xsaW5nSW50ZXJ2YWwgPCBQT0xMSU5HX0lOVEVSVkFMX0xPV0VSX0JPVU5EKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIG9wdGlvbnMucG9sbGluZ0ludGVydmFsICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgRGlyZWN0TGluZUpTOiBwcm92aWRlZCBwb2xsaW5nSW50ZXJ2YWwgKCR7IG9wdGlvbnMucG9sbGluZ0ludGVydmFsIH0pIGlzIHVuZGVyIGxvd2VyIGJvdW5kICgyMDBtcyksIHVzaW5nIGRlZmF1bHQgb2YgMTAwMG1zYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxpbmdJbnRlcnZhbCA9IHBhcnNlZFBvbGxpbmdJbnRlcnZhbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZXhwaXJlZFRva2VuRXhoYXVzdGlvbiA9IHRoaXMuc2V0Q29ubmVjdGlvblN0YXR1c0ZhbGxiYWNrKFxuICAgICAgICAgICAgQ29ubmVjdGlvblN0YXR1cy5FeHBpcmVkVG9rZW4sXG4gICAgICAgICAgICBDb25uZWN0aW9uU3RhdHVzLkZhaWxlZFRvQ29ubmVjdCxcbiAgICAgICAgICAgIDVcbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLmFjdGl2aXR5JCA9ICh0aGlzLndlYlNvY2tldFxuICAgICAgICAgICAgPyB0aGlzLndlYlNvY2tldEFjdGl2aXR5JCgpXG4gICAgICAgICAgICA6IHRoaXMucG9sbGluZ0dldEFjdGl2aXR5JCgpXG4gICAgICAgICkuc2hhcmUoKTtcbiAgICB9XG5cbiAgICAvLyBFdmVyeSB0aW1lIHdlJ3JlIGFib3V0IHRvIG1ha2UgYSBEaXJlY3QgTGluZSBSRVNUIGNhbGwsIHdlIGNhbGwgdGhpcyBmaXJzdCB0byBzZWUgY2hlY2sgdGhlIGN1cnJlbnQgY29ubmVjdGlvbiBzdGF0dXMuXG4gICAgLy8gRWl0aGVyIHRocm93cyBhbiBlcnJvciAoaW5kaWNhdGluZyBhbiBlcnJvciBzdGF0ZSkgb3IgZW1pdHMgYSBudWxsLCBpbmRpY2F0aW5nIGEgKHByZXN1bWFibHkpIGhlYWx0aHkgY29ubmVjdGlvblxuICAgIHByaXZhdGUgY2hlY2tDb25uZWN0aW9uKG9uY2UgPSBmYWxzZSkge1xuICAgICAgICBsZXQgb2JzID0gIHRoaXMuY29ubmVjdGlvblN0YXR1cyRcbiAgICAgICAgLmZsYXRNYXAoY29ubmVjdGlvblN0YXR1cyA9PiB7XG4gICAgICAgICAgICBpZiAoY29ubmVjdGlvblN0YXR1cyA9PT0gQ29ubmVjdGlvblN0YXR1cy5VbmluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0aW9uU3RhdHVzJC5uZXh0KENvbm5lY3Rpb25TdGF0dXMuQ29ubmVjdGluZyk7XG5cbiAgICAgICAgICAgICAgICAvL2lmIHRva2VuIGFuZCBzdHJlYW1VcmwgYXJlIGRlZmluZWQgaXQgbWVhbnMgcmVjb25uZWN0IGhhcyBhbHJlYWR5IGJlZW4gZG9uZS4gU2tpcHBpbmcgaXQuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMudG9rZW4gJiYgdGhpcy5zdHJlYW1VcmwpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0aW9uU3RhdHVzJC5uZXh0KENvbm5lY3Rpb25TdGF0dXMuT25saW5lKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIE9ic2VydmFibGUub2YoY29ubmVjdGlvblN0YXR1cyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3RhcnRDb252ZXJzYXRpb24oKS5kbyhjb252ZXJzYXRpb24gPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzYXRpb25JZCA9IGNvbnZlcnNhdGlvbi5jb252ZXJzYXRpb25JZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudG9rZW4gPSB0aGlzLnNlY3JldCB8fCBjb252ZXJzYXRpb24udG9rZW47XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnN0cmVhbVVybCA9IGNvbnZlcnNhdGlvbi5zdHJlYW1Vcmw7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZmVyZW5jZUdyYW1tYXJJZCA9IGNvbnZlcnNhdGlvbi5yZWZlcmVuY2VHcmFtbWFySWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuc2VjcmV0KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVmcmVzaFRva2VuTG9vcCgpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLm5leHQoQ29ubmVjdGlvblN0YXR1cy5PbmxpbmUpO1xuICAgICAgICAgICAgICAgICAgICB9LCBlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLm5leHQoQ29ubmVjdGlvblN0YXR1cy5GYWlsZWRUb0Nvbm5lY3QpO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAubWFwKF8gPT4gY29ubmVjdGlvblN0YXR1cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIE9ic2VydmFibGUub2YoY29ubmVjdGlvblN0YXR1cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5maWx0ZXIoY29ubmVjdGlvblN0YXR1cyA9PiBjb25uZWN0aW9uU3RhdHVzICE9IENvbm5lY3Rpb25TdGF0dXMuVW5pbml0aWFsaXplZCAmJiBjb25uZWN0aW9uU3RhdHVzICE9IENvbm5lY3Rpb25TdGF0dXMuQ29ubmVjdGluZylcbiAgICAgICAgLmZsYXRNYXAoY29ubmVjdGlvblN0YXR1cyA9PiB7XG4gICAgICAgICAgICBzd2l0Y2ggKGNvbm5lY3Rpb25TdGF0dXMpIHtcbiAgICAgICAgICAgICAgICBjYXNlIENvbm5lY3Rpb25TdGF0dXMuRW5kZWQ6XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmVuZGluZylcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLm9mKGNvbm5lY3Rpb25TdGF0dXMpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gT2JzZXJ2YWJsZS50aHJvdyhlcnJvckNvbnZlcnNhdGlvbkVuZGVkKTtcblxuICAgICAgICAgICAgICAgIGNhc2UgQ29ubmVjdGlvblN0YXR1cy5GYWlsZWRUb0Nvbm5lY3Q6XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLnRocm93KGVycm9yRmFpbGVkVG9Db25uZWN0KTtcblxuICAgICAgICAgICAgICAgIGNhc2UgQ29ubmVjdGlvblN0YXR1cy5FeHBpcmVkVG9rZW46XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLm9mKGNvbm5lY3Rpb25TdGF0dXMpO1xuXG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIE9ic2VydmFibGUub2YoY29ubmVjdGlvblN0YXR1cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIG9uY2UgPyBvYnMudGFrZSgxKSA6IG9icztcbiAgICB9XG5cbiAgICBzZXRDb25uZWN0aW9uU3RhdHVzRmFsbGJhY2soXG4gICAgICAgIGNvbm5lY3Rpb25TdGF0dXNGcm9tOiBDb25uZWN0aW9uU3RhdHVzLFxuICAgICAgICBjb25uZWN0aW9uU3RhdHVzVG86IENvbm5lY3Rpb25TdGF0dXMsXG4gICAgICAgIG1heEF0dGVtcHRzID0gNVxuICAgICkge1xuICAgICAgICBtYXhBdHRlbXB0cy0tO1xuICAgICAgICBsZXQgYXR0ZW1wdHMgPSAwO1xuICAgICAgICBsZXQgY3VyclN0YXR1cyA9IG51bGw7XG4gICAgICAgIHJldHVybiAoc3RhdHVzOiBDb25uZWN0aW9uU3RhdHVzKTogQ29ubmVjdGlvblN0YXR1cyA9PiB7XG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSBjb25uZWN0aW9uU3RhdHVzRnJvbSAmJiBjdXJyU3RhdHVzID09PSBzdGF0dXMgJiYgYXR0ZW1wdHMgPj0gbWF4QXR0ZW1wdHMpIHtcbiAgICAgICAgICAgICAgICBhdHRlbXB0cyA9IDBcbiAgICAgICAgICAgICAgICByZXR1cm4gY29ubmVjdGlvblN0YXR1c1RvO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXR0ZW1wdHMrKztcbiAgICAgICAgICAgIGN1cnJTdGF0dXMgPSBzdGF0dXM7XG4gICAgICAgICAgICByZXR1cm4gc3RhdHVzO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgZXhwaXJlZFRva2VuKCkge1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uU3RhdHVzID0gdGhpcy5jb25uZWN0aW9uU3RhdHVzJC5nZXRWYWx1ZSgpO1xuICAgICAgICBpZiAoY29ubmVjdGlvblN0YXR1cyAhPSBDb25uZWN0aW9uU3RhdHVzLkVuZGVkICYmIGNvbm5lY3Rpb25TdGF0dXMgIT0gQ29ubmVjdGlvblN0YXR1cy5GYWlsZWRUb0Nvbm5lY3QpXG4gICAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLm5leHQoQ29ubmVjdGlvblN0YXR1cy5FeHBpcmVkVG9rZW4pO1xuXG4gICAgICAgIGNvbnN0IHByb3RlY3RlZENvbm5lY3Rpb25TdGF0dXMgPSB0aGlzLmV4cGlyZWRUb2tlbkV4aGF1c3Rpb24odGhpcy5jb25uZWN0aW9uU3RhdHVzJC5nZXRWYWx1ZSgpKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9uU3RhdHVzJC5uZXh0KHByb3RlY3RlZENvbm5lY3Rpb25TdGF0dXMpO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhcnRDb252ZXJzYXRpb24oKSB7XG4gICAgICAgIC8vaWYgY29udmVyc2F0aW9uaWQgaXMgc2V0IGhlcmUsIGl0IG1lYW5zIHdlIG5lZWQgdG8gY2FsbCB0aGUgcmVjb25uZWN0IGFwaSwgZWxzZSBpdCBpcyBhIG5ldyBjb252ZXJzYXRpb25cbiAgICAgICAgY29uc3QgdXJsID0gdGhpcy5jb252ZXJzYXRpb25JZFxuICAgICAgICAgICAgPyBgJHt0aGlzLmRvbWFpbn0vY29udmVyc2F0aW9ucy8ke3RoaXMuY29udmVyc2F0aW9uSWR9P3dhdGVybWFyaz0ke3RoaXMud2F0ZXJtYXJrfWBcbiAgICAgICAgICAgIDogYCR7dGhpcy5kb21haW59L2NvbnZlcnNhdGlvbnNgO1xuICAgICAgICBjb25zdCBtZXRob2QgPSB0aGlzLmNvbnZlcnNhdGlvbklkID8gXCJHRVRcIiA6IFwiUE9TVFwiO1xuXG4gICAgICAgIHJldHVybiBPYnNlcnZhYmxlLmFqYXgoe1xuICAgICAgICAgICAgbWV0aG9kLFxuICAgICAgICAgICAgdXJsLFxuICAgICAgICAgICAgdGltZW91dCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICBcIkFjY2VwdFwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgICAgICAgICAuLi50aGlzLmNvbW1vbkhlYWRlcnMoKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuLy8gICAgICAuZG8oYWpheFJlc3BvbnNlID0+IGtvbnNvbGUubG9nKFwiY29udmVyc2F0aW9uIGFqYXhSZXNwb25zZVwiLCBhamF4UmVzcG9uc2UucmVzcG9uc2UpKVxuICAgICAgICAubWFwKGFqYXhSZXNwb25zZSA9PiBhamF4UmVzcG9uc2UucmVzcG9uc2UgYXMgQ29udmVyc2F0aW9uKVxuICAgICAgICAucmV0cnlXaGVuKGVycm9yJCA9PlxuICAgICAgICAgICAgLy8gZm9yIG5vdyB3ZSBkZWVtIDR4eCBhbmQgNXh4IGVycm9ycyBhcyB1bnJlY292ZXJhYmxlXG4gICAgICAgICAgICAvLyBmb3IgZXZlcnl0aGluZyBlbHNlICh0aW1lb3V0cyksIHJldHJ5IGZvciBhIHdoaWxlXG4gICAgICAgICAgICBlcnJvciQubWVyZ2VNYXAoZXJyb3IgPT4gZXJyb3Iuc3RhdHVzID49IDQwMCAmJiBlcnJvci5zdGF0dXMgPCA2MDBcbiAgICAgICAgICAgICAgICA/IE9ic2VydmFibGUudGhyb3coZXJyb3IpXG4gICAgICAgICAgICAgICAgOiBPYnNlcnZhYmxlLm9mKGVycm9yKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLmRlbGF5KHRpbWVvdXQpXG4gICAgICAgICAgICAudGFrZShyZXRyaWVzKVxuICAgICAgICApXG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWZyZXNoVG9rZW5Mb29wKCkge1xuICAgICAgICB0aGlzLnRva2VuUmVmcmVzaFN1YnNjcmlwdGlvbiA9IE9ic2VydmFibGUuaW50ZXJ2YWwoaW50ZXJ2YWxSZWZyZXNoVG9rZW4pXG4gICAgICAgIC5mbGF0TWFwKF8gPT4gdGhpcy5yZWZyZXNoVG9rZW4oKSlcbiAgICAgICAgLnN1YnNjcmliZSh0b2tlbiA9PiB7XG4gICAgICAgICAgICBrb25zb2xlLmxvZyhcInJlZnJlc2hpbmcgdG9rZW5cIiwgdG9rZW4sIFwiYXRcIiwgbmV3IERhdGUoKSk7XG4gICAgICAgICAgICB0aGlzLnRva2VuID0gdG9rZW47XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVmcmVzaFRva2VuKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0Nvbm5lY3Rpb24odHJ1ZSlcbiAgICAgICAgLmZsYXRNYXAoXyA9PlxuICAgICAgICAgICAgT2JzZXJ2YWJsZS5hamF4KHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgICAgIHVybDogYCR7dGhpcy5kb21haW59L3Rva2Vucy9yZWZyZXNoYCxcbiAgICAgICAgICAgICAgICB0aW1lb3V0LFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgLi4udGhpcy5jb21tb25IZWFkZXJzKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm1hcChhamF4UmVzcG9uc2UgPT4gYWpheFJlc3BvbnNlLnJlc3BvbnNlLnRva2VuIGFzIHN0cmluZylcbiAgICAgICAgICAgIC5yZXRyeVdoZW4oZXJyb3IkID0+IGVycm9yJFxuICAgICAgICAgICAgICAgIC5tZXJnZU1hcChlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnJvci5zdGF0dXMgPT09IDQwMykge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gaWYgdGhlIHRva2VuIGlzIGV4cGlyZWQgdGhlcmUncyBubyByZWFzb24gdG8ga2VlcCB0cnlpbmdcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZXhwaXJlZFRva2VuKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gT2JzZXJ2YWJsZS50aHJvdyhlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZXJyb3Iuc3RhdHVzID09PSA0MDQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSBib3QgaXMgZ29uZSwgd2Ugc2hvdWxkIHN0b3AgcmV0cnlpbmdcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLnRocm93KGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLm9mKGVycm9yKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5kZWxheSh0aW1lb3V0KVxuICAgICAgICAgICAgICAgIC50YWtlKHJldHJpZXMpXG4gICAgICAgICAgICApXG4gICAgICAgIClcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVjb25uZWN0KGNvbnZlcnNhdGlvbjogQ29udmVyc2F0aW9uKSB7XG4gICAgICAgIHRoaXMudG9rZW4gPSBjb252ZXJzYXRpb24udG9rZW47XG4gICAgICAgIHRoaXMuc3RyZWFtVXJsID0gY29udmVyc2F0aW9uLnN0cmVhbVVybDtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGlvblN0YXR1cyQuZ2V0VmFsdWUoKSA9PT0gQ29ubmVjdGlvblN0YXR1cy5FeHBpcmVkVG9rZW4pXG4gICAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLm5leHQoQ29ubmVjdGlvblN0YXR1cy5PbmxpbmUpO1xuICAgIH1cblxuICAgIGVuZCgpIHtcbiAgICAgICAgaWYgKHRoaXMudG9rZW5SZWZyZXNoU3Vic2NyaXB0aW9uKVxuICAgICAgICAgICAgdGhpcy50b2tlblJlZnJlc2hTdWJzY3JpcHRpb24udW5zdWJzY3JpYmUoKTtcbiAgICAgICAgdGhpcy5lbmRpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLm5leHQoQ29ubmVjdGlvblN0YXR1cy5FbmRlZCk7XG4gICAgfVxuXG4gICAgZ2V0U2Vzc2lvbklkKCk6IE9ic2VydmFibGU8c3RyaW5nPiB7XG4gICAgICAgIC8vIElmIHdlJ3JlIG5vdCBjb25uZWN0ZWQgdG8gdGhlIGJvdCwgZ2V0IGNvbm5lY3RlZFxuICAgICAgICAvLyBXaWxsIHRocm93IGFuIGVycm9yIGlmIHdlIGFyZSBub3QgY29ubmVjdGVkXG4gICAgICAgIGtvbnNvbGUubG9nKFwiZ2V0U2Vzc2lvbklkXCIpO1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0Nvbm5lY3Rpb24odHJ1ZSlcbiAgICAgICAgICAgIC5mbGF0TWFwKF8gPT5cbiAgICAgICAgICAgICAgICBPYnNlcnZhYmxlLmFqYXgoe1xuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6IFwiR0VUXCIsXG4gICAgICAgICAgICAgICAgICAgIHVybDogYCR7dGhpcy5kb21haW59L3Nlc3Npb24vZ2V0c2Vzc2lvbmlkYCxcbiAgICAgICAgICAgICAgICAgICAgd2l0aENyZWRlbnRpYWxzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICB0aW1lb3V0LFxuICAgICAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnRoaXMuY29tbW9uSGVhZGVycygpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5tYXAoYWpheFJlc3BvbnNlID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFqYXhSZXNwb25zZSAmJiBhamF4UmVzcG9uc2UucmVzcG9uc2UgJiYgYWpheFJlc3BvbnNlLnJlc3BvbnNlLnNlc3Npb25JZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAga29uc29sZS5sb2coXCJnZXRTZXNzaW9uSWQgcmVzcG9uc2U6IFwiICsgYWpheFJlc3BvbnNlLnJlc3BvbnNlLnNlc3Npb25JZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYWpheFJlc3BvbnNlLnJlc3BvbnNlLnNlc3Npb25JZCBhcyBzdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICAgICAga29uc29sZS5sb2coXCJnZXRTZXNzaW9uSWQgZXJyb3I6IFwiICsgZXJyb3Iuc3RhdHVzKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIE9ic2VydmFibGUub2YoJycpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4gdGhpcy5jYXRjaEV4cGlyZWRUb2tlbihlcnJvcikpO1xuICAgIH1cblxuICAgIHBvc3RBY3Rpdml0eShhY3Rpdml0eTogQWN0aXZpdHkpIHtcbiAgICAgICAgLy8gVXNlIHBvc3RNZXNzYWdlV2l0aEF0dGFjaG1lbnRzIGZvciBtZXNzYWdlcyB3aXRoIGF0dGFjaG1lbnRzIHRoYXQgYXJlIGxvY2FsIGZpbGVzIChlLmcuIGFuIGltYWdlIHRvIHVwbG9hZClcbiAgICAgICAgLy8gVGVjaG5pY2FsbHkgd2UgY291bGQgdXNlIGl0IGZvciAqYWxsKiBhY3Rpdml0aWVzLCBidXQgcG9zdEFjdGl2aXR5IGlzIG11Y2ggbGlnaHRlciB3ZWlnaHRcbiAgICAgICAgLy8gU28sIHNpbmNlIFdlYkNoYXQgaXMgcGFydGlhbGx5IGEgcmVmZXJlbmNlIGltcGxlbWVudGF0aW9uIG9mIERpcmVjdCBMaW5lLCB3ZSBpbXBsZW1lbnQgYm90aC5cbiAgICAgICAgaWYgKGFjdGl2aXR5LnR5cGUgPT09IFwibWVzc2FnZVwiICYmIGFjdGl2aXR5LmF0dGFjaG1lbnRzICYmIGFjdGl2aXR5LmF0dGFjaG1lbnRzLmxlbmd0aCA+IDApXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wb3N0TWVzc2FnZVdpdGhBdHRhY2htZW50cyhhY3Rpdml0eSk7XG5cbiAgICAgICAgLy8gSWYgd2UncmUgbm90IGNvbm5lY3RlZCB0byB0aGUgYm90LCBnZXQgY29ubmVjdGVkXG4gICAgICAgIC8vIFdpbGwgdGhyb3cgYW4gZXJyb3IgaWYgd2UgYXJlIG5vdCBjb25uZWN0ZWRcbiAgICAgICAga29uc29sZS5sb2coXCJwb3N0QWN0aXZpdHlcIiwgYWN0aXZpdHkpO1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0Nvbm5lY3Rpb24odHJ1ZSlcbiAgICAgICAgLmZsYXRNYXAoXyA9PlxuICAgICAgICAgICAgT2JzZXJ2YWJsZS5hamF4KHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgICAgIHVybDogYCR7dGhpcy5kb21haW59L2NvbnZlcnNhdGlvbnMvJHt0aGlzLmNvbnZlcnNhdGlvbklkfS9hY3Rpdml0aWVzYCxcbiAgICAgICAgICAgICAgICBib2R5OiBhY3Rpdml0eSxcbiAgICAgICAgICAgICAgICB0aW1lb3V0LFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgICAgICAgICAgIC4uLnRoaXMuY29tbW9uSGVhZGVycygpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAubWFwKGFqYXhSZXNwb25zZSA9PiBhamF4UmVzcG9uc2UucmVzcG9uc2UuaWQgYXMgc3RyaW5nKVxuICAgICAgICAgICAgLmNhdGNoKGVycm9yID0+IHRoaXMuY2F0Y2hQb3N0RXJyb3IoZXJyb3IpKVxuICAgICAgICApXG4gICAgICAgIC5jYXRjaChlcnJvciA9PiB0aGlzLmNhdGNoRXhwaXJlZFRva2VuKGVycm9yKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwb3N0TWVzc2FnZVdpdGhBdHRhY2htZW50cyh7IGF0dGFjaG1lbnRzLCAuLi4gbWVzc2FnZVdpdGhvdXRBdHRhY2htZW50cyB9OiBNZXNzYWdlKSB7XG4gICAgICAgIGxldCBmb3JtRGF0YTogRm9ybURhdGE7XG5cbiAgICAgICAgLy8gSWYgd2UncmUgbm90IGNvbm5lY3RlZCB0byB0aGUgYm90LCBnZXQgY29ubmVjdGVkXG4gICAgICAgIC8vIFdpbGwgdGhyb3cgYW4gZXJyb3IgaWYgd2UgYXJlIG5vdCBjb25uZWN0ZWRcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tDb25uZWN0aW9uKHRydWUpXG4gICAgICAgIC5mbGF0TWFwKF8gPT4ge1xuICAgICAgICAgICAgLy8gVG8gc2VuZCB0aGlzIG1lc3NhZ2UgdG8gRGlyZWN0TGluZSB3ZSBuZWVkIHRvIGRlY29uc3RydWN0IGl0IGludG8gYSBcInRlbXBsYXRlXCIgYWN0aXZpdHlcbiAgICAgICAgICAgIC8vIGFuZCBvbmUgYmxvYiBmb3IgZWFjaCBhdHRhY2htZW50LlxuICAgICAgICAgICAgZm9ybURhdGEgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgICAgICAgIGZvcm1EYXRhLmFwcGVuZCgnYWN0aXZpdHknLCBuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkobWVzc2FnZVdpdGhvdXRBdHRhY2htZW50cyldLCB7IHR5cGU6ICdhcHBsaWNhdGlvbi92bmQubWljcm9zb2Z0LmFjdGl2aXR5JyB9KSk7XG5cbiAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLmZyb20oYXR0YWNobWVudHMgfHwgW10pXG4gICAgICAgICAgICAuZmxhdE1hcCgobWVkaWE6IE1lZGlhKSA9PlxuICAgICAgICAgICAgICAgIE9ic2VydmFibGUuYWpheCh7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogXCJHRVRcIixcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBtZWRpYS5jb250ZW50VXJsLFxuICAgICAgICAgICAgICAgICAgICByZXNwb25zZVR5cGU6ICdhcnJheWJ1ZmZlcidcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5kbyhhamF4UmVzcG9uc2UgPT5cbiAgICAgICAgICAgICAgICAgICAgZm9ybURhdGEuYXBwZW5kKCdmaWxlJywgbmV3IEJsb2IoW2FqYXhSZXNwb25zZS5yZXNwb25zZV0sIHsgdHlwZTogbWVkaWEuY29udGVudFR5cGUgfSksIG1lZGlhLm5hbWUpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLmNvdW50KClcbiAgICAgICAgfSlcbiAgICAgICAgLmZsYXRNYXAoXyA9PlxuICAgICAgICAgICAgT2JzZXJ2YWJsZS5hamF4KHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgICAgIHVybDogYCR7dGhpcy5kb21haW59L2NvbnZlcnNhdGlvbnMvJHt0aGlzLmNvbnZlcnNhdGlvbklkfS91cGxvYWQ/dXNlcklkPSR7bWVzc2FnZVdpdGhvdXRBdHRhY2htZW50cy5mcm9tLmlkfWAsXG4gICAgICAgICAgICAgICAgYm9keTogZm9ybURhdGEsXG4gICAgICAgICAgICAgICAgdGltZW91dCxcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnRoaXMuY29tbW9uSGVhZGVycygpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5tYXAoYWpheFJlc3BvbnNlID0+IGFqYXhSZXNwb25zZS5yZXNwb25zZS5pZCBhcyBzdHJpbmcpXG4gICAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4gdGhpcy5jYXRjaFBvc3RFcnJvcihlcnJvcikpXG4gICAgICAgIClcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHRoaXMuY2F0Y2hQb3N0RXJyb3IoZXJyb3IpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNhdGNoUG9zdEVycm9yKGVycm9yOiBhbnkpIHtcbiAgICAgICAgaWYgKGVycm9yLnN0YXR1cyA9PT0gNDAzKVxuICAgICAgICAgICAgLy8gdG9rZW4gaGFzIGV4cGlyZWQgKHdpbGwgZmFsbCB0aHJvdWdoIHRvIHJldHVybiBcInJldHJ5XCIpXG4gICAgICAgICAgICB0aGlzLmV4cGlyZWRUb2tlbigpO1xuICAgICAgICBlbHNlIGlmIChlcnJvci5zdGF0dXMgPj0gNDAwICYmIGVycm9yLnN0YXR1cyA8IDUwMClcbiAgICAgICAgICAgIC8vIG1vcmUgdW5yZWNvdmVyYWJsZSBlcnJvcnNcbiAgICAgICAgICAgIHJldHVybiBPYnNlcnZhYmxlLnRocm93KGVycm9yKTtcbiAgICAgICAgcmV0dXJuIE9ic2VydmFibGUub2YoXCJyZXRyeVwiKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNhdGNoRXhwaXJlZFRva2VuKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcmV0dXJuIGVycm9yID09PSBlcnJvckV4cGlyZWRUb2tlblxuICAgICAgICA/IE9ic2VydmFibGUub2YoXCJyZXRyeVwiKVxuICAgICAgICA6IE9ic2VydmFibGUudGhyb3coZXJyb3IpO1xuICAgIH1cblxuICAgIHByaXZhdGUgcG9sbGluZ0dldEFjdGl2aXR5JCgpIHtcbiAgICAgICAgY29uc3QgcG9sbGVyJDogT2JzZXJ2YWJsZTxBamF4UmVzcG9uc2U+ID0gT2JzZXJ2YWJsZS5jcmVhdGUoKHN1YnNjcmliZXI6IFN1YnNjcmliZXI8YW55PikgPT4ge1xuICAgICAgICAgICAgLy8gQSBCZWhhdmlvclN1YmplY3QgdG8gdHJpZ2dlciBwb2xsaW5nLiBTaW5jZSBpdCBpcyBhIEJlaGF2aW9yU3ViamVjdFxuICAgICAgICAgICAgLy8gdGhlIGZpcnN0IGV2ZW50IGlzIHByb2R1Y2VkIGltbWVkaWF0ZWx5LlxuICAgICAgICAgICAgY29uc3QgdHJpZ2dlciQgPSBuZXcgQmVoYXZpb3JTdWJqZWN0PGFueT4oe30pO1xuXG4gICAgICAgICAgICB0cmlnZ2VyJC5zdWJzY3JpYmUoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLmdldFZhbHVlKCkgPT09IENvbm5lY3Rpb25TdGF0dXMuT25saW5lKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZXN0YW1wID0gRGF0ZS5ub3coKTtcblxuICAgICAgICAgICAgICAgICAgICBPYnNlcnZhYmxlLmFqYXgoe1xuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLnRoaXMuY29tbW9uSGVhZGVycygpXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYCR7IHRoaXMuZG9tYWluIH0vY29udmVyc2F0aW9ucy8keyB0aGlzLmNvbnZlcnNhdGlvbklkIH0vYWN0aXZpdGllcz93YXRlcm1hcms9JHsgdGhpcy53YXRlcm1hcmsgfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB0aW1lb3V0XG4gICAgICAgICAgICAgICAgICAgIH0pLnN1YnNjcmliZShcbiAgICAgICAgICAgICAgICAgICAgICAgIChyZXN1bHQ6IEFqYXhSZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1YnNjcmliZXIubmV4dChyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gdHJpZ2dlciQubmV4dChudWxsKSwgTWF0aC5tYXgoMCwgdGhpcy5wb2xsaW5nSW50ZXJ2YWwgLSBEYXRlLm5vdygpICsgc3RhcnRUaW1lc3RhbXApKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoZXJyb3Iuc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgNDAzOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0aW9uU3RhdHVzJC5uZXh0KENvbm5lY3Rpb25TdGF0dXMuRXhwaXJlZFRva2VuKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gdHJpZ2dlciQubmV4dChudWxsKSwgdGhpcy5wb2xsaW5nSW50ZXJ2YWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSA0MDQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0dXMkLm5leHQoQ29ubmVjdGlvblN0YXR1cy5FbmRlZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcHJvcGFnYXRlIHRoZSBlcnJvclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3Vic2NyaWJlci5lcnJvcihlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrQ29ubmVjdGlvbigpXG4gICAgICAgIC5mbGF0TWFwKF8gPT4gcG9sbGVyJFxuICAgICAgICAgICAgLmNhdGNoKCgpID0+IE9ic2VydmFibGUuZW1wdHk8QWpheFJlc3BvbnNlPigpKVxuICAgICAgICAgICAgLm1hcChhamF4UmVzcG9uc2UgPT4gYWpheFJlc3BvbnNlLnJlc3BvbnNlIGFzIEFjdGl2aXR5R3JvdXApXG4gICAgICAgICAgICAuZmxhdE1hcChhY3Rpdml0eUdyb3VwID0+IHRoaXMub2JzZXJ2YWJsZUZyb21BY3Rpdml0eUdyb3VwKGFjdGl2aXR5R3JvdXApKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBvYnNlcnZhYmxlRnJvbUFjdGl2aXR5R3JvdXAoYWN0aXZpdHlHcm91cDogQWN0aXZpdHlHcm91cCkge1xuICAgICAgICBpZiAoYWN0aXZpdHlHcm91cC53YXRlcm1hcmspXG4gICAgICAgICAgICB0aGlzLndhdGVybWFyayA9IGFjdGl2aXR5R3JvdXAud2F0ZXJtYXJrO1xuICAgICAgICByZXR1cm4gT2JzZXJ2YWJsZS5mcm9tKGFjdGl2aXR5R3JvdXAuYWN0aXZpdGllcyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB3ZWJTb2NrZXRBY3Rpdml0eSQoKTogT2JzZXJ2YWJsZTxBY3Rpdml0eT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5jaGVja0Nvbm5lY3Rpb24oKVxuICAgICAgICAuZmxhdE1hcChfID0+XG4gICAgICAgICAgICB0aGlzLm9ic2VydmFibGVXZWJTb2NrZXQ8QWN0aXZpdHlHcm91cD4oKVxuICAgICAgICAgICAgLy8gV2ViU29ja2V0cyBjYW4gYmUgY2xvc2VkIGJ5IHRoZSBzZXJ2ZXIgb3IgdGhlIGJyb3dzZXIuIEluIHRoZSBmb3JtZXIgY2FzZSB3ZSBuZWVkIHRvXG4gICAgICAgICAgICAvLyByZXRyaWV2ZSBhIG5ldyBzdHJlYW1VcmwuIEluIHRoZSBsYXR0ZXIgY2FzZSB3ZSBjb3VsZCBmaXJzdCByZXRyeSB3aXRoIHRoZSBjdXJyZW50IHN0cmVhbVVybCxcbiAgICAgICAgICAgIC8vIGJ1dCBpdCdzIHNpbXBsZXIganVzdCB0byBhbHdheXMgZmV0Y2ggYSBuZXcgb25lLlxuICAgICAgICAgICAgLnJldHJ5V2hlbihlcnJvciQgPT4gZXJyb3IkLmRlbGF5KHRoaXMuZ2V0UmV0cnlEZWxheSgpKS5tZXJnZU1hcChlcnJvciA9PiB0aGlzLnJlY29ubmVjdFRvQ29udmVyc2F0aW9uKCkpKVxuICAgICAgICApXG4gICAgICAgIC5mbGF0TWFwKGFjdGl2aXR5R3JvdXAgPT4gdGhpcy5vYnNlcnZhYmxlRnJvbUFjdGl2aXR5R3JvdXAoYWN0aXZpdHlHcm91cCkpXG4gICAgfVxuXG4gICAgLy8gUmV0dXJucyB0aGUgZGVsYXkgZHVyYXRpb24gaW4gbWlsbGlzZWNvbmRzXG4gICAgcHJpdmF0ZSBnZXRSZXRyeURlbGF5KCkge1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcigzMDAwICsgTWF0aC5yYW5kb20oKSAqIDEyMDAwKTtcbiAgICB9XG5cbiAgICAvLyBPcmlnaW5hbGx5IHdlIHVzZWQgT2JzZXJ2YWJsZS53ZWJTb2NrZXQsIGJ1dCBpdCdzIGZhaXJseSBvcGlvbmF0ZWQgIGFuZCBJIGVuZGVkIHVwIHdyaXRpbmdcbiAgICAvLyBhIGxvdCBvZiBjb2RlIHRvIHdvcmsgYXJvdW5kIHRoZWlyIGltcGxlbWVudGlvbiBkZXRhaWxzLiBTaW5jZSBXZWJDaGF0IGlzIG1lYW50IHRvIGJlIGEgcmVmZXJlbmNlXG4gICAgLy8gaW1wbGVtZW50YXRpb24sIEkgZGVjaWRlZCByb2xsIHRoZSBiZWxvdywgd2hlcmUgdGhlIGxvZ2ljIGlzIG1vcmUgcHVycG9zZWZ1bC4gLSBAYmlsbGJhXG4gICAgcHJpdmF0ZSBvYnNlcnZhYmxlV2ViU29ja2V0PFQ+KCkge1xuICAgICAgICByZXR1cm4gT2JzZXJ2YWJsZS5jcmVhdGUoKHN1YnNjcmliZXI6IFN1YnNjcmliZXI8VD4pID0+IHtcbiAgICAgICAgICAgIGtvbnNvbGUubG9nKFwiY3JlYXRpbmcgV2ViU29ja2V0XCIsIHRoaXMuc3RyZWFtVXJsKTtcbiAgICAgICAgICAgIGNvbnN0IHdzID0gbmV3IFdlYlNvY2tldCh0aGlzLnN0cmVhbVVybCk7XG4gICAgICAgICAgICBsZXQgc3ViOiBTdWJzY3JpcHRpb247XG5cbiAgICAgICAgICAgIHdzLm9ub3BlbiA9IG9wZW4gPT4ge1xuICAgICAgICAgICAgICAgIGtvbnNvbGUubG9nKFwiV2ViU29ja2V0IG9wZW5cIiwgb3Blbik7XG4gICAgICAgICAgICAgICAgLy8gQ2hyb21lIGlzIHByZXR0eSBiYWQgYXQgbm90aWNpbmcgd2hlbiBhIFdlYlNvY2tldCBjb25uZWN0aW9uIGlzIGJyb2tlbi5cbiAgICAgICAgICAgICAgICAvLyBJZiB3ZSBwZXJpb2RpY2FsbHkgcGluZyB0aGUgc2VydmVyIHdpdGggZW1wdHkgbWVzc2FnZXMsIGl0IGhlbHBzIENocm9tZVxuICAgICAgICAgICAgICAgIC8vIHJlYWxpemUgd2hlbiBjb25uZWN0aW9uIGJyZWFrcywgYW5kIGNsb3NlIHRoZSBzb2NrZXQuIFdlIHRoZW4gdGhyb3cgYW5cbiAgICAgICAgICAgICAgICAvLyBlcnJvciwgYW5kIHRoYXQgZ2l2ZSB1cyB0aGUgb3Bwb3J0dW5pdHkgdG8gYXR0ZW1wdCB0byByZWNvbm5lY3QuXG4gICAgICAgICAgICAgICAgc3ViID0gT2JzZXJ2YWJsZS5pbnRlcnZhbCh0aW1lb3V0KS5zdWJzY3JpYmUoXyA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3cy5zZW5kKFwiXCIpXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAga29uc29sZS5sb2coXCJQaW5nIGVycm9yXCIsIGUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHdzLm9uY2xvc2UgPSBjbG9zZSA9PiB7XG4gICAgICAgICAgICAgICAga29uc29sZS5sb2coXCJXZWJTb2NrZXQgY2xvc2VcIiwgY2xvc2UpO1xuICAgICAgICAgICAgICAgIGlmIChzdWIpIHN1Yi51bnN1YnNjcmliZSgpO1xuICAgICAgICAgICAgICAgIHN1YnNjcmliZXIuZXJyb3IoY2xvc2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB3cy5vbm1lc3NhZ2UgPSBtZXNzYWdlID0+IG1lc3NhZ2UuZGF0YSAmJiBzdWJzY3JpYmVyLm5leHQoSlNPTi5wYXJzZShtZXNzYWdlLmRhdGEpKTtcblxuICAgICAgICAgICAgd3Mub25lcnJvciA9IGVycm9yID0+ICB7XG4gICAgICAgICAgICAgICAga29uc29sZS5sb2coXCJXZWJTb2NrZXQgZXJyb3JcIiwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIGlmIChzdWIpIHN1Yi51bnN1YnNjcmliZSgpO1xuICAgICAgICAgICAgICAgIHN1YnNjcmliZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBUaGlzIGlzIHRoZSAndW5zdWJzY3JpYmUnIG1ldGhvZCwgd2hpY2ggaXMgY2FsbGVkIHdoZW4gdGhpcyBvYnNlcnZhYmxlIGlzIGRpc3Bvc2VkLlxuICAgICAgICAgICAgLy8gV2hlbiB0aGUgV2ViU29ja2V0IGNsb3NlcyBpdHNlbGYsIHdlIHRocm93IGFuIGVycm9yLCBhbmQgdGhpcyBmdW5jdGlvbiBpcyBldmVudHVhbGx5IGNhbGxlZC5cbiAgICAgICAgICAgIC8vIFdoZW4gdGhlIG9ic2VydmFibGUgaXMgY2xvc2VkIGZpcnN0IChlLmcuIHdoZW4gdGVhcmluZyBkb3duIGEgV2ViQ2hhdCBpbnN0YW5jZSkgdGhlblxuICAgICAgICAgICAgLy8gd2UgbmVlZCB0byBtYW51YWxseSBjbG9zZSB0aGUgV2ViU29ja2V0LlxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAod3MucmVhZHlTdGF0ZSA9PT0gMCB8fCB3cy5yZWFkeVN0YXRlID09PSAxKSB3cy5jbG9zZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KSBhcyBPYnNlcnZhYmxlPFQ+XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWNvbm5lY3RUb0NvbnZlcnNhdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY2hlY2tDb25uZWN0aW9uKHRydWUpXG4gICAgICAgIC5mbGF0TWFwKF8gPT5cbiAgICAgICAgICAgIE9ic2VydmFibGUuYWpheCh7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiBcIkdFVFwiLFxuICAgICAgICAgICAgICAgIHVybDogYCR7dGhpcy5kb21haW59L2NvbnZlcnNhdGlvbnMvJHt0aGlzLmNvbnZlcnNhdGlvbklkfT93YXRlcm1hcms9JHt0aGlzLndhdGVybWFya31gLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQsXG4gICAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcIkFjY2VwdFwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgICAgICAgICAgICAgLi4udGhpcy5jb21tb25IZWFkZXJzKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmRvKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLnNlY3JldClcbiAgICAgICAgICAgICAgICAgICAgdGhpcy50b2tlbiA9IHJlc3VsdC5yZXNwb25zZS50b2tlbjtcbiAgICAgICAgICAgICAgICB0aGlzLnN0cmVhbVVybCA9IHJlc3VsdC5yZXNwb25zZS5zdHJlYW1Vcmw7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm1hcChfID0+IG51bGwpXG4gICAgICAgICAgICAucmV0cnlXaGVuKGVycm9yJCA9PiBlcnJvciRcbiAgICAgICAgICAgICAgICAubWVyZ2VNYXAoZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3Iuc3RhdHVzID09PSA0MDMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRva2VuIGhhcyBleHBpcmVkLiBXZSBjYW4ndCByZWNvdmVyIGZyb20gdGhpcyBoZXJlLCBidXQgdGhlIGVtYmVkZGluZ1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2Vic2l0ZSBtaWdodCBldmVudHVhbGx5IGNhbGwgcmVjb25uZWN0KCkgd2l0aCBhIG5ldyB0b2tlbiBhbmQgc3RyZWFtVXJsLlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5leHBpcmVkVG9rZW4oKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlcnJvci5zdGF0dXMgPT09IDQwNCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIE9ic2VydmFibGUudGhyb3coZXJyb3JDb252ZXJzYXRpb25FbmRlZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gT2JzZXJ2YWJsZS5vZihlcnJvcik7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAuZGVsYXkodGltZW91dClcbiAgICAgICAgICAgICAgICAudGFrZShyZXRyaWVzKVxuICAgICAgICAgICAgKVxuICAgICAgICApXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb21tb25IZWFkZXJzKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgXCJBdXRob3JpemF0aW9uXCI6IGBCZWFyZXIgJHt0aGlzLnRva2VufWAsXG4gICAgICAgICAgICBcIngtbXMtYm90LWFnZW50XCI6IHRoaXMuX2JvdEFnZW50XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRCb3RBZ2VudChjdXN0b21BZ2VudDogc3RyaW5nID0gJycpOiBzdHJpbmcge1xuICAgICAgICBsZXQgY2xpZW50QWdlbnQgPSAnZGlyZWN0bGluZWpzJ1xuXG4gICAgICAgIGlmIChjdXN0b21BZ2VudCkge1xuICAgICAgICAgICAgY2xpZW50QWdlbnQgKz0gYDsgJHtjdXN0b21BZ2VudH1gXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYCR7RElSRUNUX0xJTkVfVkVSU0lPTn0gKCR7Y2xpZW50QWdlbnR9KWA7XG4gICAgfVxufVxuIl19