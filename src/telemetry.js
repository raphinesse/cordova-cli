/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

// For further details on telemetry, see:
// https://github.com/cordova/cordova-discuss/pull/43

const { EOL } = require('os');
const pkg = require('../package.json');
const Insight = require('insight');

// Google Analytics tracking code
const GA_TRACKING_CODE = 'UA-64283057-7';
const PROMPT_MESSAGE = 'May Cordova anonymously report usage statistics to improve the tool over time?';

/**
 * By redefining `get optOut` we trick Insight into tracking
 * even though the user might have opted out.
 */
class RelentlessInsight extends Insight {
    get optOut () { return false; }
    set optOut (value) { super.optOut = value; }
    get realOptOut () { return super.optOut; }
}

const insight = new RelentlessInsight({
    trackingCode: GA_TRACKING_CODE,
    pkg: pkg
});

let trackOverride;

function initialize (args = []) {
    Promise.resolve().then(() => {
        // Never track if user gave the --no-telemetry flag
        if (args.includes('--no-telemetry')) {
            return (trackOverride = 'never');
        }

        // Always track if user runs `cordova telemetry`
        if (args[2] === 'telemetry') {
            return (trackOverride = 'always');
        }

        // Get saved telemetry decision or prompt user for it
        return ensureUserDecision();
    });
}

/**
 * Returns true if the user opted in, and false otherwise
 */
function showPrompt () {
    return new Promise((resolve, reject) => {
        insight.askPermission(PROMPT_MESSAGE, (_, optIn) => {
            if (optIn) {
                console.log(EOL + 'Thanks for opting into telemetry to help us improve cordova.');
                exports.track('telemetry', 'on', 'via-cli-prompt-choice');
            } else {
                console.log(EOL + 'You have been opted out of telemetry. To change this, run: cordova telemetry on.');
                // Always track telemetry opt-outs! (whether opted-in or opted-out)
                exports.track('telemetry', 'off', 'via-cli-prompt-choice');
            }
            resolve(optIn);
        });
    });
}

/**
 * Show telemetry prompt to user unless saved decision is available.
 * If no choice is made within 30 seconds opt-out is assumed.
 *
 * @return {boolean} true iff user opted in to telemetry
 */
function ensureUserDecision () {
    return Promise.resolve().then(_ =>
        exports.hasUserOptedInOrOut() ?
            exports.isOptedIn() :
            exports.showPrompt()
    );
}

function shouldTrack () {
    switch (trackOverride) {
    case 'always':
        return true;
    case 'never':
        return false;
    default:
        return exports.isOptedIn();
    }
}

function track (...args) {
    if (!shouldTrack()) return;

    // Remove empty, null or undefined strings from arguments
    const filteredArgs = args.filter(val => val && val.length !== 0);
    insight.track(...filteredArgs);
}

function turnOn () {
    insight.optOut = false;
    exports.track('telemetry', 'on', 'via-cordova-telemetry-cmd');
}

function turnOff () {
    exports.track('telemetry', 'off', 'via-cordova-telemetry-cmd');
    insight.optOut = true;
}

function isOptedIn () {
    return insight.realOptOut === false;
}

/**
 * Has the user already answered the telemetry prompt? (thereby opting in or out?)
 */
function hasUserOptedInOrOut () {
    return insight.realOptOut !== undefined;
}

module.exports = exports = {
    initialize,
    track: track,
    turnOn: turnOn,
    turnOff: turnOff,
    isOptedIn: isOptedIn,
    hasUserOptedInOrOut: hasUserOptedInOrOut,
    showPrompt: showPrompt
};
