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

var path = require('path');
var nopt = require('nopt');
var updateNotifier = require('update-notifier');
var pkg = require('../package.json');
var telemetry = require('./telemetry');
var help = require('./help');
var cordova_lib = require('cordova-lib');
var CordovaError = cordova_lib.CordovaError;
var cordova = cordova_lib.cordova;
var events = cordova_lib.events;
var logger = require('cordova-common').CordovaLogger.get();
var Configstore = require('configstore');
var conf = new Configstore(pkg.name + '-config');
var editor = require('editor');
const semver = require('semver');

// process.version is not declared writable or has no setter so storing in const for Jasmine.
const NODE_VERSION = process.version;

// When there is no node version in the deprecation stage, set to null or false.
const NODE_VERSION_REQUIREMENT = '>=8';
const NODE_VERSION_DEPRECATING_RANGE = '<10';

var knownOpts = {
    'verbose': Boolean,
    'version': Boolean,
    'help': Boolean,
    'silent': Boolean,
    'experimental': Boolean,
    'noregistry': Boolean,
    'nohooks': Array,
    'shrinkwrap': Boolean,
    'link-to': path,
    'searchpath': String,
    'variable': Array,
    'link': Boolean,
    'force': Boolean,
    'save-exact': Boolean,
    // Flags to be passed to `cordova build/run/emulate`
    'debug': Boolean,
    'release': Boolean,
    'archs': String,
    'device': Boolean,
    'emulator': Boolean,
    'target': String,
    'noprepare': Boolean,
    'nobuild': Boolean,
    'list': Boolean,
    'buildConfig': String,
    'template': String,
    'production': Boolean,
    'noprod': Boolean
};

var shortHands = {
    'd': '--verbose',
    'v': '--version',
    'h': '--help',
    't': '--template'
};

function checkForUpdates () {
    try {
        // Checks for available update and returns an instance
        var notifier = updateNotifier({ pkg: pkg });

        if (notifier.update &&
           notifier.update.latest !== pkg.version) {
            // Notify using the built-in convenience method
            notifier.notify();
        }
    } catch (e) {
        // https://issues.apache.org/jira/browse/CB-10062
        if (e && e.message && /EACCES/.test(e.message)) {
            console.log('Update notifier was not able to access the config file.\n' +
                'You may grant permissions to the file: \'sudo chmod 744 ~/.config/configstore/update-notifier-cordova.json\'');
        } else {
            throw e;
        }
    }
}

module.exports = function (inputArgs) {
    // If no inputArgs given, use process.argv.
    inputArgs = inputArgs || process.argv;
    var cmd = inputArgs[2]; // e.g: inputArgs= 'node cordova run ios'
    var subcommand = getSubCommand(inputArgs, cmd);
    var isTelemetryCmd = (cmd === 'telemetry');
    var isConfigCmd = (cmd === 'config');

    // ToDO: Move nopt-based parsing of args up here
    if (cmd === '--version' || cmd === '-v') {
        cmd = 'version';
    } else if (!cmd || cmd === '--help' || cmd === 'h') {
        cmd = 'help';
    }

    // If "get" is called
    if (isConfigCmd && inputArgs[3] === 'get') {
        if (inputArgs[4]) {
            logger.subscribe(events);
            conf.get(inputArgs[4]);
            if (conf.get(inputArgs[4]) !== undefined) {
                events.emit('log', conf.get(inputArgs[4]).toString());
            } else {
                events.emit('log', 'undefined');
            }
        }
    }

    // If "set" is called
    if (isConfigCmd && inputArgs[3] === 'set') {
        if (inputArgs[5] === undefined) {
            conf.set(inputArgs[4], true);
        }

        if (inputArgs[5]) {
            conf.set(inputArgs[4], inputArgs[5]);
        }
    }

    // If "delete" is called
    if (isConfigCmd && inputArgs[3] === 'delete') {
        if (inputArgs[4]) {
            conf.del(inputArgs[4]);
        }
    }

    // If "edit" is called
    if (isConfigCmd && inputArgs[3] === 'edit') {
        editor(conf.path, function (code, sig) {
            logger.warn('Finished editing with code ' + code);
        });
    }

    // If "ls" is called
    if (isConfigCmd && (inputArgs[3] === 'ls' || inputArgs[3] === 'list')) {
        logger.results(JSON.stringify(conf.all, null, 4));
    }

    return Promise.resolve().then(function () {
        // Let telemetry module decide whether track is a no-op or not.
        // Possibly by prompting the user.
        return telemetry.initialize({ argv: inputArgs, env: process.env });
    }).then(function () {
        if (isTelemetryCmd) {
            return handleTelemetryCmd(subcommand);
        }
        return cli(inputArgs);
    }).then(
        () => telemetry.track(cmd, subcommand, 'successful'),
        err => {
            telemetry.track(cmd, subcommand, 'unsuccessful');
            throw err;
        }
    );
};

function getSubCommand (args, cmd) {
    if (['platform', 'platforms', 'plugin', 'plugins', 'telemetry', 'config'].indexOf(cmd) > -1) {
        return args[3]; // e.g: args='node cordova platform rm ios', 'node cordova telemetry on'
    }
    return null;
}

function printHelp (command) {
    var result = help([command]);
    cordova.emit('results', result);
}

function handleTelemetryCmd (subcommand) {
    if (subcommand !== 'on' && subcommand !== 'off') {
        logger.subscribe(events);
        printHelp('telemetry');
        return;
    }

    // turn telemetry on or off
    if (subcommand === 'on') {
        telemetry.turnOn();
        console.log('Thanks for opting into telemetry to help us improve cordova.');
    } else {
        telemetry.turnOff();
        console.log('You have been opted out of telemetry. To change this, run: cordova telemetry on.');
    }
}

function cli (inputArgs) {

    checkForUpdates();

    var args = nopt(knownOpts, shortHands, inputArgs);

    process.on('uncaughtException', function (err) {
        if (err.message) {
            logger.error(err.message);
        } else {
            logger.error(err);
        }
        // Don't send exception details, just send that it happened
        telemetry.track('uncaughtException');
        process.exitCode = 1;
    });

    logger.subscribe(events);

    if (args.silent) {
        logger.setLevel('error');
    } else if (args.verbose) { // can't be both silent AND verbose, silent wins
        logger.setLevel('verbose');
    }

    var cliVersion = pkg.version;
    var usingPrerelease = !!semver.prerelease(cliVersion);
    if (args.version || usingPrerelease) {
        var libVersion = require('cordova-lib/package').version;
        var toPrint = cliVersion;
        if (cliVersion !== libVersion || usingPrerelease) {
            toPrint += ' (cordova-lib@' + libVersion + ')';
        }

        if (args.version) {
            logger.results(toPrint);
            return Promise.resolve(); // Important! this will return and cease execution
        } else { // must be usingPrerelease
            // Show a warning and continue
            logger.warn('Warning: using prerelease version ' + toPrint);
        }
    }

    let warningPartial = null;

    // If the Node.js versions does not meet our requirements or in a deprecation stage, display a warning.
    if (!semver.satisfies(NODE_VERSION, NODE_VERSION_REQUIREMENT)) {
        warningPartial = 'is no longer supported';
    } else if (NODE_VERSION_DEPRECATING_RANGE &&
               semver.satisfies(NODE_VERSION, NODE_VERSION_DEPRECATING_RANGE)) {
        warningPartial = 'has been deprecated';
    }

    if (warningPartial) {
        const upgradeMsg = `Please upgrade to the latest Node.js version available (LTS version recommended).`;
        logger.warn(`Warning: Node.js ${NODE_VERSION} ${warningPartial}. ${upgradeMsg}`);
    }

    // If there were arguments protected from nopt with a double dash, keep
    // them in unparsedArgs. For example:
    // cordova build ios -- --verbose --whatever
    // In this case "--verbose" is not parsed by nopt and args.vergbose will be
    // false, the unparsed args after -- are kept in unparsedArgs and can be
    // passed downstream to some scripts invoked by Cordova.
    var unparsedArgs = [];
    var parseStopperIdx = args.argv.original.indexOf('--');
    if (parseStopperIdx !== -1) {
        unparsedArgs = args.argv.original.slice(parseStopperIdx + 1);
    }

    // args.argv.remain contains both the undashed args (like platform names)
    // and whatever unparsed args that were protected by " -- ".
    // "undashed" stores only the undashed args without those after " -- " .
    var remain = args.argv.remain;
    var undashed = remain.slice(0, remain.length - unparsedArgs.length);
    var cmd = undashed[0];
    var subcommand;

    if (!cmd || cmd === 'help' || args.help) {
        if (!args.help && remain[0] === 'help') {
            remain.shift();
        }
        return printHelp(remain);
    }

    if (!cordova.hasOwnProperty(cmd)) {
        var msg2 = 'Cordova does not know ' + cmd + '; try `' + cordova_lib.binname +
            ' help` for a list of all the available commands.';
        throw new CordovaError(msg2);
    }

    var opts = {
        platforms: [],
        options: [],
        verbose: args.verbose || false,
        silent: args.silent || false,
        nohooks: args.nohooks || [],
        searchpath: args.searchpath
    };

    var platformCommands = ['emulate', 'build', 'prepare', 'compile', 'run', 'clean'];
    if (platformCommands.indexOf(cmd) !== -1) {

        // All options without dashes are assumed to be platform names
        opts.platforms = undashed.slice(1);

        // Pass nopt-parsed args to PlatformApi through opts.options
        opts.options = args;
        opts.options.argv = unparsedArgs;
        if (cmd === 'run' && args.list && cordova.targets) {
            return cordova.targets.call(null, opts);
        }
        return cordova[cmd].call(null, opts);

    } else if (cmd === 'requirements') {
        // All options without dashes are assumed to be platform names
        opts.platforms = undashed.slice(1);

        return cordova[cmd].call(null, opts.platforms)
            .then(function (platformChecks) {

                var someChecksFailed = Object.keys(platformChecks).map(function (platformName) {
                    events.emit('log', '\nRequirements check results for ' + platformName + ':');
                    var platformCheck = platformChecks[platformName];
                    if (platformCheck instanceof CordovaError) {
                        events.emit('warn', 'Check failed for ' + platformName + ' due to ' + platformCheck);
                        return true;
                    }

                    var someChecksFailed = false;

                    // platformCheck is expected to be an array of conditions that must be met
                    // the browser platform currently returns nothing, which was breaking here.
                    if (platformCheck && platformCheck.forEach) {
                        platformCheck.forEach(function (checkItem) {
                            var checkSummary = checkItem.name + ': ' +
                                (checkItem.installed ? 'installed ' : 'not installed ') +
                                (checkItem.installed ? checkItem.metadata.version.version || checkItem.metadata.version : '');
                            events.emit('log', checkSummary);
                            if (!checkItem.installed) {
                                someChecksFailed = true;
                                events.emit('warn', checkItem.metadata.reason);
                            }
                        });
                    }
                    return someChecksFailed;
                }).some(function (isCheckFailedForPlatform) {
                    return isCheckFailedForPlatform;
                });

                if (someChecksFailed) {
                    throw new CordovaError('Some of requirements check failed');
                }
            });
    } else if (cmd === 'serve') {
        var port = undashed[1];
        return cordova.serve(port);
    } else if (cmd === 'create') {
        return create(undashed, args);
    } else if (cmd === 'config') {
        // Don't need to do anything with cordova-lib since config was handled above
        return true;
    } else {
        // platform/plugins add/rm [target(s)]
        subcommand = undashed[1]; // sub-command like "add", "ls", "rm" etc.
        var targets = undashed.slice(2); // array of targets, either platforms or plugins
        var cli_vars = {};
        if (args.variable) {
            args.variable.forEach(function (strVar) {
                // CB-9171
                var keyVal = strVar.split('=');
                if (keyVal.length < 2) {
                    throw new CordovaError('invalid variable format: ' + strVar);
                } else {
                    var key = keyVal.shift().toUpperCase();
                    var val = keyVal.join('=');
                    cli_vars[key] = val;
                }
            });
        }

        if (args.nosave) {
            args.save = false;
        } else {
            args.save = true;
        }

        if (args.noprod) {
            args.production = false;
        } else {
            args.production = true;
        }

        if (args.save === undefined) {
            // User explicitly did not pass in save
            args.save = conf.get('autosave');
        }
        if (args.searchpath === undefined) {
            // User explicitly did not pass in searchpath
            args.searchpath = conf.get('searchpath');
        }
        if (args.production === undefined) {
            // User explicitly did not pass in noprod
            args.production = conf.get('production');
        }

        if (args['save-exact'] === undefined) {
            // User explicitly did not pass in save-exact
            args['save-exact'] = conf.get('save-exact');
        }

        var download_opts = { searchpath: args.searchpath,
            noregistry: args.noregistry,
            nohooks: args.nohooks,
            cli_variables: cli_vars,
            link: args.link || false,
            save: args.save,
            save_exact: args['save-exact'] || false,
            shrinkwrap: args.shrinkwrap || false,
            force: args.force || false,
            production: args.production
        };
        return cordova[cmd](subcommand, targets, download_opts);
    }
}

function create ([_, dir, id, name, cfgJson], args) {
    // If we got a fourth parameter, consider it to be JSON to init the config.
    var cfg = JSON.parse(cfgJson || '{}');

    // Template path
    var customWww = args['link-to'] || args.template;

    if (customWww) {
        // TODO Handle in create
        if (!args.template && customWww.indexOf('http') === 0) {
            throw new CordovaError(
                'Only local paths for custom www assets are supported for linking' + customWww
            );
        }

        // Resolve tilda
        // TODO: move to create and use sindresorhus/untildify
        if (customWww.substr(0, 1) === '~') { customWww = path.join(process.env.HOME, customWww.substr(1)); }

        // Template config
        var wwwCfg = {
            url: customWww,
            template: 'template' in args,
            link: 'link-to' in args
        };

        cfg.lib = cfg.lib || {};
        cfg.lib.www = wwwCfg;
    }
    return cordova.create(dir, id, name, cfg, events || undefined);
}
