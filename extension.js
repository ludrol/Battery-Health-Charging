'use strict';
const Main = imports.ui.main;
const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const [major] = Config.PACKAGE_VERSION.split('.');
const shellVersion = Number.parseInt(major);

const Initializer = Me.imports.lib.initializer;
const PowerIcon = shellVersion > 42 ? Me.imports.lib.powerIcon : Me.imports.lib.powerIcon42;

var initializer = null;
var powerIcon = null;
let sessionId = null;

function init() {
    ExtensionUtils.initTranslations(Me.metadata.uuid);
}

// 1.  initializer runs only in [user] session-mode. initializer is destroyed in [unlock-dialog] session-mode
// initializer initializes and checks hardware compatibility and displays an indicator of current charging mode in system-tray and also provides a
// quicksettings menu in the quicksettings panel.
// all this are required in [user] sessionmode, but not required in [unlock-dialog] mode initializer hence needs to be destroyed.

// 2. powerIcon runs in [user] and [unlock-dialog] session mode
// When charging-threshold applied, the Gnome's System Battery indicator icon sometimes displays unplugged, even though charger is plugged.
// powerIcon introduces a feature to changes this icon from unplugged to plugged when charger is plugged.
// Since this icon is a Gnome's System Battery indicator which is displayed in lockscreen, powerIcon need to be enabled in [unlock-dialog] session mode.
// powerIcon runs in [user] and [unlock-dialog] session mode to apply correct icon to Gnome System Battery indicator icon in System-tray.

function enable() {
    // Do not create threshold panel if enable is triggered in lockscreen state (due rebased while disabling other extensions)
    if (!Main.sessionMode.isLocked && initializer === null)
        initializer = new Initializer.InitializeDriver();


    // create when enabled() is called in [user] and [unlock-dialog] session mode
    powerIcon = new PowerIcon.BatteryStatusIndicator();

    // Destroy initializer on [unlock-dialog] / create initializer in [user]
    sessionId = Main.sessionMode.connect('updated', session => {
        // enable initializer when entering from [unlock-dialog] to [user] session-mode.
        if (session.currentMode === 'user' || session.parentMode === 'user') {
            if (initializer === null)
                initializer = new Initializer.InitializeDriver();

        // destroy initializer when entering [unlock-dialog] session mode.
        } else if (session.currentMode === 'unlock-dialog') {
            initializer.destroy();
            initializer = null;
        }
    });
}

function disable() {
    // Destroy everything if disable() is called regardless of session-mode
    if (sessionId) {
        Main.sessionMode.disconnect(sessionId);
        sessionId = null;
    }

    if (initializer !== null) {
        initializer.destroy();
        initializer = null;
    }

    powerIcon.disable();
    powerIcon = null;
}

