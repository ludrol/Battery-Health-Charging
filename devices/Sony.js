'use strict';
/* Sony Laptops */
const {GObject} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Helper = Me.imports.lib.helper;
const {fileExists, readFileInt, runCommandCtl} = Helper;

const SONY_PATH = '/sys/devices/platform/sony-laptop/battery_care_limiter';
const SONY_HIGHSPEED_CHARGING_PATH = '/sys/devices/platform/sony-laptop/battery_highspeed_charging';

var SonySingleBattery = GObject.registerClass({
    Signals: {'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class SonySingleBattery extends GObject.Object {
    name = 'Sony';
    type = 7;
    deviceNeedRootPermission = true;
    deviceHaveDualBattery = false;
    deviceHaveStartThreshold = false;
    deviceHaveVariableThreshold = false;
    deviceHaveBalancedMode = true;
    deviceHaveAdaptiveMode = false;
    deviceHaveExpressMode = false;
    deviceUsesModeNotValue = false;
    iconForFullCapMode = '100';
    iconForBalanceMode = '080';
    iconForMaxLifeMode = '050';

    isAvailable() {
        if (!fileExists(SONY_PATH))
            return false;
        if (fileExists(SONY_HIGHSPEED_CHARGING_PATH))
            this.deviceHaveExpressMode = true;
        return true;
    }

    async setThresholdLimit(chargingMode) {
        let batteryCareLimiter, highspeedCharging, status;
        if (chargingMode === 'ful') {
            batteryCareLimiter = 0;
            highspeedCharging = 0;
        } else if (chargingMode === 'bal') {
            batteryCareLimiter = 80;
            highspeedCharging = 0;
        } else if (chargingMode === 'max') {
            batteryCareLimiter = 50;
            highspeedCharging = 0;
        } else if (chargingMode === 'exp') {
            batteryCareLimiter = 0;
            highspeedCharging = 1;
        }

        if (highspeedCharging === 1) {
            status = await runCommandCtl('SONY', `${batteryCareLimiter}`, null, false);
            if (status === 0 && (readFileInt(SONY_PATH) === batteryCareLimiter))
                status = await runCommandCtl('SONY_HIGHSPEED_CHARGING', `${highspeedCharging}`, null, false);
            if (status === 0 && readFileInt(SONY_HIGHSPEED_CHARGING_PATH) === highspeedCharging) {
                this.endLimitValue = 100;
                this.mode = chargingMode;
                this.emit('threshold-applied', true);
                return 0;
            }
        } else {
            status = 0;
            if (this.deviceHaveExpressMode) {
                status = await runCommandCtl('SONY_HIGHSPEED_CHARGING', `${highspeedCharging}`, null, false);
                if (status === 0 && readFileInt(SONY_HIGHSPEED_CHARGING_PATH) === highspeedCharging)
                    this.mode = chargingMode;
                else
                    status = 1;
            }
            if (status === 0) {
                status = await runCommandCtl('SONY', `${batteryCareLimiter}`, null, false);
                if (status === 0) {
                    const endLimitValue = readFileInt(SONY_PATH);
                    if (batteryCareLimiter === endLimitValue) {
                        this.endLimitValue = endLimitValue === 0 ? 100 : endLimitValue;
                        this.emit('threshold-applied', true);
                        return 0;
                    }
                }
            }
        }
        this.emit('threshold-applied', false);
        return 1;
    }

    destroy() {
        // Nothing to destroy for this device
    }
});

