'use strict';
/* Thinkpad Legacy Laptops using dkms https://github.com/linux-thinkpad/tp_smapi  */
const {Gio, GLib, GObject} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Helper = Me.imports.lib.helper;
const {readFile, fileExists, readFileInt, readFileUri, runCommandCtl} = Helper;

const BUS_NAME = 'org.freedesktop.UPower';
const R_BAT0_OBJECT_PATH = '/org/freedesktop/UPower/devices/battery_BAT0';
const R_BAT1_OBJECT_PATH = '/org/freedesktop/UPower/devices/battery_BAT1';
const XMLFILE = 'resource:///org/gnome/shell/dbus-interfaces/org.freedesktop.UPower.Device.xml';
const UpowerProxy = Gio.DBusProxy.makeProxyWrapper(readFileUri(XMLFILE));

const R_TP_BAT0_END = '/sys/devices/platform/smapi/BAT0/stop_charge_thresh';
const R_TP_BAT0_START = '/sys/devices/platform/smapi/BAT0/start_charge_thresh';
const R_TP_BAT1_END = '/sys/devices/platform/smapi/BAT1/stop_charge_thresh';
const R_TP_BAT1_START = '/sys/devices/platform/smapi/BAT1/start_charge_thresh';
const ADP0_ONLINE_PATH = '/sys/devices/platform/smapi/ac_connected';
const R_TPBAT0_FORCE_DISCHARGE = '/sys/devices/platform/smapi/BAT0/force_discharge';
const R_TPBAT1_FORCE_DISCHARGE = '/sys/devices/platform/smapi/BAT1/force_discharge';
const R_BAT0_CAPACITY_PATH = '/sys/devices/platform/smapi/BAT0/remaining_percent';
const R_BAT1_CAPACITY_PATH = '/sys/devices/platform/smapi/BAT1/remaining_percent';
const R_BAT0_STATUS = '/sys/devices/platform/smapi/BAT0/state';
const R_BAT1_STATUS = '/sys/devices/platform/smapi/BAT1/state';

let BAT0_OBJECT_PATH, BAT1_OBJECT_PATH, TP_BAT0_END, TP_BAT0_START, TP_BAT1_END, TP_BAT1_START,
    TPBAT0_FORCE_DISCHARGE, TPBAT1_FORCE_DISCHARGE, BAT0_CAPACITY_PATH, BAT1_CAPACITY_PATH, BAT0_STATUS, BAT1_STATUS;

var ThinkpadLegacyDualBattery = GObject.registerClass({
    Signals: {
        'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]},
        'battery-status-changed': {},
        'charge-properties-updated': {},
    },
}, class ThinkpadLegacyDualBattery extends GObject.Object {
    name = 'Thinkpad tpsmapi BAT0/BAT1';
    type = 13;
    deviceNeedRootPermission = true;
    deviceHaveDualBattery = true;
    deviceHaveStartThreshold = true;
    deviceHaveVariableThreshold = true;
    deviceHaveBalancedMode = true;
    deviceHaveAdaptiveMode = false;
    deviceHaveExpressMode = false;
    deviceUsesModeNotValue = false;
    iconForFullCapMode = '100';
    iconForBalanceMode = '080';
    iconForMaxLifeMode = '060';
    endFullCapacityRangeMax = 100;
    endFullCapacityRangeMin = 80;
    endBalancedRangeMax = 85;
    endBalancedRangeMin = 65;
    endMaxLifeSpanRangeMax = 85;
    endMaxLifeSpanRangeMin = 50;
    startFullCapacityRangeMax = 95;
    startFullCapacityRangeMin = 75;
    startBalancedRangeMax = 80;
    startBalancedRangeMin = 60;
    startMaxLifeSpanRangeMax = 80;
    startMaxLifeSpanRangeMin = 40;
    minDiffLimit = 5;

    isAvailable() {
        const deviceType = ExtensionUtils.getSettings().get_int('device-type');
        if (deviceType === 0) {
            if (!fileExists(R_TP_BAT1_START))
                return false;
            if (!fileExists(R_TP_BAT1_END))
                return false;
            if (!fileExists(R_TP_BAT0_START))
                return false;
            if (!fileExists(R_TP_BAT0_END))
                return false;
            if (fileExists(R_TPBAT0_FORCE_DISCHARGE) && fileExists(R_TPBAT1_FORCE_DISCHARGE))
                ExtensionUtils.getSettings().set_boolean('supports-force-discharge', true);
            this.battery1Removed = false;
        }
        const swapBattery = ExtensionUtils.getSettings().get_boolean('dual-bat-correction');
        BAT0_OBJECT_PATH = swapBattery ? R_BAT1_OBJECT_PATH : R_BAT0_OBJECT_PATH;
        BAT1_OBJECT_PATH = swapBattery ? R_BAT0_OBJECT_PATH : R_BAT1_OBJECT_PATH;
        TP_BAT0_END = swapBattery ? R_TP_BAT1_END : R_TP_BAT0_END;
        TP_BAT0_START = swapBattery ? R_TP_BAT1_START : R_TP_BAT0_START;
        TP_BAT1_END = swapBattery ? R_TP_BAT0_END : R_TP_BAT1_END;
        TP_BAT1_START = swapBattery ? R_TP_BAT0_START : R_TP_BAT1_START;
        TPBAT0_FORCE_DISCHARGE = swapBattery ? R_TPBAT1_FORCE_DISCHARGE : R_TPBAT0_FORCE_DISCHARGE;
        TPBAT1_FORCE_DISCHARGE = swapBattery ? R_TPBAT0_FORCE_DISCHARGE : R_TPBAT1_FORCE_DISCHARGE;
        BAT0_CAPACITY_PATH = swapBattery ? R_BAT1_CAPACITY_PATH : R_BAT0_CAPACITY_PATH;
        BAT1_CAPACITY_PATH = swapBattery ? R_BAT0_CAPACITY_PATH : R_BAT1_CAPACITY_PATH;
        BAT0_STATUS = swapBattery ? R_BAT1_STATUS : R_BAT0_STATUS;
        BAT1_STATUS = swapBattery ? R_BAT0_STATUS : R_BAT1_STATUS;

        this.battery1Removed = !fileExists(TP_BAT1_END);

        return true;
    }

    async setThresholdLimit(chargingMode) {
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode}-end-threshold`);
        const startValue = settings.get_int(`current-${chargingMode}-start-threshold`);
        const oldEndValue = readFileInt(TP_BAT0_END);
        const oldStartValue = readFileInt(TP_BAT0_START);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimitValue = endValue;
            this.startLimitValue = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('TP_BAT0_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('TP_BAT0_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimitValue = readFileInt(TP_BAT0_END);
            this.startLimitValue = readFileInt(TP_BAT0_START);
            if ((endValue === this.endLimitValue) && (startValue === this.startLimitValue)) {
                this.emit('threshold-applied', true);
                return 0;
            }
        }
        this.emit('threshold-applied', false);
        return 1;
    }

    async setThresholdLimit2(chargingMode2) {
        if (this.battery1Removed)
            return 0;
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode2}-end-threshold2`);
        const startValue = settings.get_int(`current-${chargingMode2}-start-threshold2`);
        const oldEndValue = readFileInt(TP_BAT1_END);
        const oldStartValue = readFileInt(TP_BAT1_START);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimit2Value = endValue;
            this.startLimit2Value = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('TP_BAT1_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('TP_BAT1_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimit2Value = readFileInt(TP_BAT1_END);
            this.startLimit2Value = readFileInt(TP_BAT1_START);
            if ((endValue === this.endLimit2Value) && (startValue === this.startLimit2Value)) {
                this.emit('threshold-applied', true);
                return 0;
            }
        }
        return 1;
    }

    async setThresholdLimitDual() {
        const settings = ExtensionUtils.getSettings();
        let status = await this.setThresholdLimit(settings.get_string('charging-mode'));
        if (status === 0)
            status = await this.setThresholdLimit2(settings.get_string('charging-mode2'));
        return status;
    }

    initializeBatteryMonitoring() {
        this._supportsForceDischarge = ExtensionUtils.getSettings().get_boolean('supports-force-discharge');
        if (this._supportsForceDischarge) {
            const mode = ExtensionUtils.getSettings().get_string('drain-mode');
            if (mode === 'auto')
                this.setForceDischargeMode(mode);
        }

        this._battery1LevelPath = Gio.File.new_for_path(TP_BAT1_END);
        this._monitorLevel2 = this._battery1LevelPath.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitorLevel2Id = this._monitorLevel2.connect('changed', async (obj, theFile, otherFile, eventType) => {
            if (eventType === Gio.FileMonitorEvent.DELETED) {
                if (this._supportsForceDischarge) {
                    this._destroyProxy2();
                    this.battery1Level = 0;
                    this._battery1Status = 9;
                }
                this.battery1Removed = true;
                this.emit('battery-status-changed');
                if (this._supportsForceDischarge)
                    this.updateDischargeMode();
            }
            if (eventType === Gio.FileMonitorEvent.CREATED) {
                if (this._supportsForceDischarge)
                    this.batteryEjectMode = false;
                this.battery1Removed = false;
                await this.setThresholdLimit2(ExtensionUtils.getSettings().get_string('charging-mode2'));
                if (this._supportsForceDischarge) {
                    this._startProxy2();
                    this.battery1Level = this._proxy2.Percentage;
                    this._battery1Status = this._proxy2.State;
                }
                this.emit('battery-status-changed');
                if (this._supportsForceDischarge)
                    this.updateDischargeMode();
            }
        });
        if (this._supportsForceDischarge) {
            this._startProxy();
            this._startProxy2();
            this.chargerPlugged = readFileInt(ADP0_ONLINE_PATH) === 1;
            this.battery0Level = readFileInt(BAT0_CAPACITY_PATH);
            this.battery0Status = this._readConvertStatus(BAT0_STATUS);
            this.bat0ReadMode = readFileInt(TPBAT0_FORCE_DISCHARGE) === 1 ? 'force-discharge' : 'auto';

            if (this.battery1Removed) {
                this.battery1Level = 0;
                this.battery1Status = 'Removed';
                this.bat1ReadMode = 'removed';
            } else {
                this.battery1Level = readFileInt(BAT1_CAPACITY_PATH);
                this.battery1Status = this._readConvertStatus(BAT1_STATUS);
                this.bat1ReadMode = readFileInt(TPBAT1_FORCE_DISCHARGE) === 1 ? 'force-discharge' : 'auto';
            }
            this.batteryEjectMode = false;
            this._updateDischargeMode();
        }
    }

    _startProxy() {
        this._proxy = new UpowerProxy(Gio.DBus.system, BUS_NAME, BAT0_OBJECT_PATH, (proxy, error) => {
            if (error) {
                log(error.message);
            } else {
                this._proxyId = this._proxy.connect('g-properties-changed', async () => {
                    if (this.battery0Level !== this._proxy.Percentage) {
                        this.battery0Level = this._proxy.Percentage;
                        this.updateDischargeMode();
                    }
                    if (this._oldBattery0Status !== this._proxy.State) {
                        this._oldBattery0Status = this._proxy.State;
                        this.battery0Status = this._readConvertStatus(BAT0_STATUS);
                        this.updateDischargeMode();
                    }
                    const online = readFileInt(ADP0_ONLINE_PATH) === 1;
                    if (this.chargerPlugged !== online) {
                        this.chargerPlugged = online;
                        await this._updateDischargeMode();
                        if (online) {
                            await this.setThresholdLimit(ExtensionUtils.getSettings().get_string('charging-mode'));
                            if (this.battery1Removed)
                                await this.setThresholdLimit2(ExtensionUtils.getSettings().get_string('charging-mode2'));
                        }
                    }
                });
            }
        });
    }

    _startProxy2() {
        this._proxy2 = new UpowerProxy(Gio.DBus.system, BUS_NAME, BAT1_OBJECT_PATH, (proxy2, error) => {
            if (error) {
                log(error.message);
            } else {
                this._proxy2Id = this._proxy2.connect('g-properties-changed', () => {
                    if (this.battery1Level !== this._proxy2.Percentage) {
                        this.battery1Level = this._proxy2.Percentage;
                        this.updateDischargeMode();
                    }
                    if (this._oldBattery1Status !== this._proxy2.State) {
                        this._oldBattery1Status = this._proxy2.State;
                        this.battery1Status = this.battery1Removed ? 'Removed' : this._readConvertStatus(BAT1_STATUS);
                        this.updateDischargeMode();
                    }
                });
            }
        });
    }

    _readConvertStatus(statusPath) {
        let status;
        const state = readFile(statusPath).trim();
        if (state === 'charging')
            status = 'Charging';
        else if (state === 'discharging')
            status = 'Discharging';
        else if (state === 'idle')
            status = 'Not charging';
        return status;
    }

    _batteryStatus() {
        if (this.battery1Removed)
            this.battery1Status = 'Removed';
        this.bat0ReadMode = readFileInt(TPBAT0_FORCE_DISCHARGE) === 1 ? 'force-discharge' : 'auto';
        if (this.battery1Removed)
            this.bat1ReadMode = 'removed';
        else
            this.bat1ReadMode = readFileInt(TPBAT1_FORCE_DISCHARGE) === 1 ? 'force-discharge' : 'auto';

        log(`xxxx this.chargerPlugged = ${this.chargerPlugged}`);
        log(`xxxx this.battery1Removed = ${this.battery1Removed}`);
        log(`xxxx this.batteryEjectMode = ${this.batteryEjectMode}`);
        log(`xxxx this.battery0Status = ${this.battery0Status}`);
        log(`xxxx this.battery1Status = ${this.battery1Status}`);
        log(`xxxx this.battery0Level = ${this.battery0Level}`);
        log(`xxxx this.battery1Level = ${this.battery1Level}`);
        log(`xxxx this.bat0ReadMode = ${this.bat0ReadMode}`);
        log(`xxxx this.bat1ReadMode = ${this.bat1ReadMode}`);
        log('-------------------------xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx------------------------------');
        this.emit('charge-properties-updated');
    }

    async setForceDischargeMode(switchMode) {
        this.bat0ReadMode = readFileInt(TPBAT0_FORCE_DISCHARGE) === 1 ? 'force-discharge' : 'auto';
        if (this.battery1Removed)
            this.bat1ReadMode = 'removed';
        else
            this.bat1ReadMode = readFileInt(TPBAT1_FORCE_DISCHARGE) === 1 ? 'force-discharge' : 'auto';
        log(`---- this.bat0ReadMode = ${this.bat0ReadMode}`);
        log(`---- this.bat1ReadMode = ${this.bat1ReadMode}`);
        if (switchMode === 'auto') {
            if (this.bat0ReadMode !== 'auto')
                await runCommandCtl('TPBAT0_DISCHARGE', '0', null, false);
            if ((this.bat1ReadMode !== 'auto') && (this.bat1ReadMode !== 'removed'))
                await runCommandCtl('TPBAT1_DISCHARGE', '0', null, false);
        } else if (switchMode === 'bat0') {
            if ((this.bat1ReadMode !== 'auto') && (this.bat1ReadMode !== 'removed'))
                await runCommandCtl('TPBAT1_DISCHARGE', '0', null, false);
            if (this.bat0ReadMode !== 'force-discharge')
                await runCommandCtl('TPBAT0_DISCHARGE', '1', null, false);
        } else if (switchMode === 'bat1') {
            if (this.bat0ReadMode !== 'auto')
                await runCommandCtl('TPBAT0_DISCHARGE', '0', null, false);
            if ((this.bat1ReadMode !== 'force-discharge') && (this.bat1ReadMode !== 'removed'))
                await runCommandCtl('TPBAT1_DISCHARGE', '1', null, false);
        }
        this._batteryStatus();
    }

    async _updateDischargeMode() {
        log('entering updateDischargeMode');
        if (this.chargerPlugged) {
            await this.setForceDischargeMode('auto');
        } else if (this.battery1Removed) {
            await this.setForceDischargeMode('bat0');
        } else if (this.batteryEjectMode) {
            await this.setForceDischargeMode('bat0');
        } else {
            const mode = ExtensionUtils.getSettings().get_string('drain-mode');
            if (mode === 'auto') {
                await this.setForceDischargeMode('auto');
            } else if (mode === 'bat1') {
                const changeoverValue = ExtensionUtils.getSettings().get_int('change-over-value');
                if (this.battery1Level > changeoverValue)
                    await this.setForceDischargeMode('bat1');
                else if (this.battery1Level <= changeoverValue && this.battery0Level > changeoverValue)
                    await this.setForceDischargeMode('bat0');
                else if (this.battery1Level > 5 && this.battery1Level <= changeoverValue && this.battery0Level <= changeoverValue)
                    await this.setForceDischargeMode('bat1');
                else if (this.battery1Level <= 5 && this.battery0Level > 5 && this.battery0Level <= changeoverValue)
                    await this.setForceDischargeMode('bat0');
                else if (this.battery1Level <= 5 && this.battery0Level <= 5)
                    await this.setForceDischargeMode('auto');
            }
        }
    }

    updateDischargeMode() {
        if (this._updateModeTimeoutId)
            GLib.source_remove(this._updateModeTimeoutId);
        delete this._updateModeTimeoutId;

        this._updateModeTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateDischargeMode();
            delete this._updateModeTimeoutId;
            return GLib.SOURCE_REMOVE;
        });
    }

    _destroyProxy2() {
        if (this._proxy2 !== null)
            this._proxy2.disconnect(this._proxy2Id);
        this._proxy2Id = null;
        this._proxy2 = null;
    }

    destroy() {
        if (this._monitorLevel2Id)
            this._monitorLevel2.disconnect(this._monitorLevel2Id);
        this._monitorLevel2Id = null;
        if (this._monitorLevel2)
            this._monitorLevel2.cancel();
        this._monitorLevel2 = null;
        this._battery1LevelPath = null;

        if (this._proxy !== null)
            this._proxy.disconnect(this._proxyId);
        this._proxyId = null;
        this._proxy = null;

        this._destroyProxy2();

        if (this._updateModeTimeoutId)
            GLib.source_remove(this._updateModeTimeoutId);
        delete this._updateModeTimeoutId;
    }
});

var ThinkpadLegacySingleBatteryBAT0 = GObject.registerClass({
    Signals: {'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class ThinkpadLegacySingleBatteryBAT0 extends GObject.Object {
    name = 'Thinkpad tpsmapi BAT0';
    type = 14;
    deviceNeedRootPermission = true;
    deviceHaveDualBattery = false;
    deviceHaveStartThreshold = true;
    deviceHaveVariableThreshold = true;
    deviceHaveBalancedMode = true;
    deviceHaveAdaptiveMode = false;
    deviceHaveExpressMode = false;
    deviceUsesModeNotValue = false;
    iconForFullCapMode = '100';
    iconForBalanceMode = '080';
    iconForMaxLifeMode = '060';
    endFullCapacityRangeMax = 100;
    endFullCapacityRangeMin = 80;
    endBalancedRangeMax = 85;
    endBalancedRangeMin = 65;
    endMaxLifeSpanRangeMax = 85;
    endMaxLifeSpanRangeMin = 50;
    startFullCapacityRangeMax = 95;
    startFullCapacityRangeMin = 75;
    startBalancedRangeMax = 80;
    startBalancedRangeMin = 60;
    startMaxLifeSpanRangeMax = 80;
    startMaxLifeSpanRangeMin = 40;
    minDiffLimit = 5;

    isAvailable() {
        if (!fileExists(R_TP_BAT0_START))
            return false;
        if (!fileExists(R_TP_BAT0_END))
            return false;
        if (fileExists(R_TP_BAT1_END))
            return false;
        return true;
    }

    async setThresholdLimit(chargingMode) {
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode}-end-threshold`);
        const startValue = settings.get_int(`current-${chargingMode}-start-threshold`);
        const oldEndValue = readFileInt(R_TP_BAT0_END);
        const oldStartValue = readFileInt(R_TP_BAT0_START);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimitValue = endValue;
            this.startLimitValue = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('TP_BAT0_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('TP_BAT0_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimitValue = readFileInt(R_TP_BAT0_END);
            this.startLimitValue = readFileInt(R_TP_BAT0_START);
            if ((endValue === this.endLimitValue) && (startValue === this.startLimitValue)) {
                this.emit('threshold-applied', true);
                return 0;
            }
        }
        this.emit('threshold-applied', false);
        return 1;
    }

    destroy() {
        // Nothing to destroy for this device
    }
});

var ThinkpadLegacySingleBatteryBAT1 = GObject.registerClass({
    Signals: {'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class ThinkpadLegacySingleBatteryBAT1 extends GObject.Object {
    name = 'Thinkpad tpsmapi BAT1';
    type = 15;
    deviceNeedRootPermission = true;
    deviceHaveDualBattery = false;
    deviceHaveStartThreshold = true;
    deviceHaveVariableThreshold = true;
    deviceHaveBalancedMode = true;
    deviceHaveAdaptiveMode = false;
    deviceHaveExpressMode = false;
    deviceUsesModeNotValue = false;
    iconForFullCapMode = '100';
    iconForBalanceMode = '080';
    iconForMaxLifeMode = '060';
    endFullCapacityRangeMax = 100;
    endFullCapacityRangeMin = 80;
    endBalancedRangeMax = 85;
    endBalancedRangeMin = 65;
    endMaxLifeSpanRangeMax = 85;
    endMaxLifeSpanRangeMin = 50;
    startFullCapacityRangeMax = 95;
    startFullCapacityRangeMin = 75;
    startBalancedRangeMax = 80;
    startBalancedRangeMin = 60;
    startMaxLifeSpanRangeMax = 80;
    startMaxLifeSpanRangeMin = 40;
    minDiffLimit = 5;

    isAvailable() {
        if (!fileExists(R_TP_BAT1_START))
            return false;
        if (!fileExists(R_TP_BAT1_END))
            return false;
        if (fileExists(R_TP_BAT0_END))
            return false;
        return true;
    }

    async setThresholdLimit(chargingMode) {
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode}-end-threshold`);
        const startValue = settings.get_int(`current-${chargingMode}-start-threshold`);
        const oldEndValue = readFileInt(R_TP_BAT1_END);
        const oldStartValue = readFileInt(R_TP_BAT1_START);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimitValue = endValue;
            this.startLimitValue = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('TP_BAT1_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('TP_BAT1_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimitValue = readFileInt(R_TP_BAT1_END);
            this.startLimitValue = readFileInt(R_TP_BAT1_START);
            if ((endValue === this.endLimitValue) && (startValue === this.startLimitValue)) {
                this.emit('threshold-applied', true);
                return 0;
            }
        }
        this.emit('threshold-applied', false);
        return 1;
    }

    destroy() {
        // Nothing to destroy for this device
    }
});

