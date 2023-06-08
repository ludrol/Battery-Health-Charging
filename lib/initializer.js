'use strict';
const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Driver = Me.imports.lib.driver;
const Notify = Me.imports.lib.notifier;
const [major] = Config.PACKAGE_VERSION.split('.');
const shellVersion = Number.parseInt(major);

const Panel = shellVersion > 42 ? Me.imports.lib.thresholdPanel : Me.imports.lib.thresholdPanel42;
var thresholdPanel;

var InitializeDriver = class {
    constructor() {
        this._settings = ExtensionUtils.getSettings();
        this._checkCompatibility();
    }

    async _checkCompatibility() {
        if (shellVersion < 42) {
            Notify.notifyGnomeIncompatible();
            return;
        }
        if (Driver.getCurrentDevice() === false) {
            Notify.notifyUnsupportedDevice();
            return;   // Unsupported Device
        }
        this._device = Driver.currentDevice;

        if (this._device.deviceNeedRootPermission) {
            const installStatus = await Driver.checkInstallation();
            this._installationStatus = this._settings.get_int('install-service');

            this._settings.connectObject(
                'changed::install-service', () => {
                    const newInstallStatus = this._settings.get_int('install-service');
                    if ((this._installationStatus === 1) && (newInstallStatus === 0)) {
                        Notify.notifyPolkitInstallationSuccessful();
                        this._installationStatus = newInstallStatus;
                    }
                    if ((this._installationStatus === 2) && (newInstallStatus === 0)) {
                        Notify.notifyPolkitUpdateSuccessful();
                        this._installationStatus = newInstallStatus;
                    }
                    if ((this._installationStatus === 0) && (newInstallStatus === 1)) {
                        Notify.notifyUnInstallationSuccessful();
                        this._installationStatus = newInstallStatus;
                    }
                },
                this
            );
            if (installStatus === 1) { // Polkit Needs Update
                Notify.notifyNeedPolkitUpdate();
                return;
            } else if (installStatus === 2) { // Polkit not installed
                Notify.notifyNoPolkitInstalled();// 1
                return;
            }
        }

        let status;
        if (this._device.deviceHaveDualBattery) {
            this._settings.connectObject('changed::supports-force-discharge', () => {
                thresholdPanel.destroy();
                thresholdPanel = new Panel.ThresholdPanel();
                this._device.destroy();
                if (!this._settings.get_boolean('supports-force-discharge'))
                    this._device.setForceDischargeMode('auto');
                this._device.initializeBatteryMonitoring();
            }, this);
            status = await this._device.setThresholdLimitDual();
        } else {
            status = await this._device.setThresholdLimit(this._settings.get_string('charging-mode'));
        }
        if (status !== 0) {
            Notify.notifyAnErrorOccured(this._device.name);
            return;
        }

        thresholdPanel = new Panel.ThresholdPanel();
    }

    destroy() {
        if (this._device !== undefined)
            this._device.destroy();
        this._device = null;
        Notify.removeActiveNofications();
        this._settings.disconnectObject(this);
        this._settings = null;
        thresholdPanel.destroy();
        Driver.destroy();
    }
};
