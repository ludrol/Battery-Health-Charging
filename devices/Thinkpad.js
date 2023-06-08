'use strict';
/* Thinkpad Laptops */
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

const VENDOR_THINKPAD = '/sys/devices/platform/thinkpad_acpi';
const R_BAT0_END_PATH = '/sys/class/power_supply/BAT0/charge_control_end_threshold';
const R_BAT0_START_PATH = '/sys/class/power_supply/BAT0/charge_control_start_threshold';
const R_BAT1_END_PATH = '/sys/class/power_supply/BAT1/charge_control_end_threshold';
const R_BAT1_START_PATH = '/sys/class/power_supply/BAT1/charge_control_start_threshold';
const ADP0_ONLINE_PATH = '/sys/class/power_supply/ADP0/online';
const ADP1_ONLINE_PATH = '/sys/class/power_supply/ADP1/online';
const R_BAT0_CHARGING_BEHAVIOUR = '/sys/class/power_supply/BAT0/charge_behaviour';
const R_BAT1_CHARGING_BEHAVIOUR = '/sys/class/power_supply/BAT1/charge_behaviour';
const R_BAT0_CAPACITY_PATH = '/sys/class/power_supply/BAT0/capacity';
const R_BAT1_CAPACITY_PATH = '/sys/class/power_supply/BAT1/capacity';
const R_BAT0_STATUS = '/sys/class/power_supply/BAT0/status';
const R_BAT1_STATUS = '/sys/class/power_supply/BAT1/status';

let BAT0_OBJECT_PATH, BAT1_OBJECT_PATH, BAT0_END_PATH, BAT0_START_PATH, BAT1_END_PATH, BAT1_START_PATH,
    BAT0_CHARGING_BEHAVIOUR, BAT1_CHARGING_BEHAVIOUR, BAT0_CAPACITY_PATH, BAT1_CAPACITY_PATH, BAT0_STATUS, BAT1_STATUS;

var ThinkpadDualBattery = GObject.registerClass({
    Signals: {
        'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]},
        'battery-status-changed': {},
        'charge-properties-updated': {},
    },
}, class ThinkpadDualBattery extends GObject.Object {
    name = 'Thinkpad BAT0/BAT1';
    type = 19;
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
    startFullCapacityRangeMax = 98;
    startFullCapacityRangeMin = 75;
    startBalancedRangeMax = 83;
    startBalancedRangeMin = 60;
    startMaxLifeSpanRangeMax = 83;
    startMaxLifeSpanRangeMin = 40;
    minDiffLimit = 2;

    isAvailable() {
        const deviceType = ExtensionUtils.getSettings().get_int('device-type');
        if (deviceType === 0) {
            if (!fileExists(VENDOR_THINKPAD))
                return false;
            if (!fileExists(R_BAT1_START_PATH))
                return false;
            if (!fileExists(R_BAT1_END_PATH))
                return false;
            if (!fileExists(R_BAT0_START_PATH))
                return false;
            if (!fileExists(R_BAT0_END_PATH))
                return false;
            if (fileExists(R_BAT0_CHARGING_BEHAVIOUR) && fileExists(R_BAT1_CHARGING_BEHAVIOUR))
                ExtensionUtils.getSettings().set_boolean('supports-force-discharge', true);
            this.battery1Removed = false;
        }

        if (fileExists(ADP0_ONLINE_PATH))
            this._adpPath = ADP0_ONLINE_PATH;
        if (fileExists(ADP1_ONLINE_PATH))
            this._adpPath = ADP1_ONLINE_PATH;

        const swapBattery = ExtensionUtils.getSettings().get_boolean('dual-bat-correction');
        BAT0_OBJECT_PATH = swapBattery ? R_BAT1_OBJECT_PATH : R_BAT0_OBJECT_PATH;
        BAT1_OBJECT_PATH = swapBattery ? R_BAT0_OBJECT_PATH : R_BAT1_OBJECT_PATH;
        BAT0_END_PATH = swapBattery ? R_BAT1_END_PATH : R_BAT0_END_PATH;
        BAT0_START_PATH = swapBattery ? R_BAT1_START_PATH : R_BAT0_START_PATH;
        BAT1_END_PATH = swapBattery ? R_BAT0_END_PATH : R_BAT1_END_PATH;
        BAT1_START_PATH = swapBattery ? R_BAT0_START_PATH : R_BAT1_START_PATH;
        BAT0_CHARGING_BEHAVIOUR = swapBattery ? R_BAT1_CHARGING_BEHAVIOUR : R_BAT0_CHARGING_BEHAVIOUR;
        BAT1_CHARGING_BEHAVIOUR = swapBattery ? R_BAT0_CHARGING_BEHAVIOUR : R_BAT1_CHARGING_BEHAVIOUR;
        BAT0_CAPACITY_PATH = swapBattery ? R_BAT1_CAPACITY_PATH : R_BAT0_CAPACITY_PATH;
        BAT1_CAPACITY_PATH = swapBattery ? R_BAT0_CAPACITY_PATH : R_BAT1_CAPACITY_PATH;
        BAT0_STATUS = swapBattery ? R_BAT1_STATUS : R_BAT0_STATUS;
        BAT1_STATUS = swapBattery ? R_BAT0_STATUS : R_BAT1_STATUS;

        this.battery1Removed = !fileExists(BAT1_END_PATH);

        return true;
    }

    async setThresholdLimit(chargingMode) {
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode}-end-threshold`);
        const startValue = settings.get_int(`current-${chargingMode}-start-threshold`);
        const oldEndValue = readFileInt(BAT0_END_PATH);
        const oldStartValue = readFileInt(BAT0_START_PATH);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimitValue = endValue;
            this.startLimitValue = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('BAT0_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('BAT0_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimitValue = readFileInt(BAT0_END_PATH);
            this.startLimitValue = readFileInt(BAT0_START_PATH);
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
        const oldEndValue = readFileInt(BAT1_END_PATH);
        const oldStartValue = readFileInt(BAT1_START_PATH);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimit2Value = endValue;
            this.startLimit2Value = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('BAT1_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('BAT1_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimit2Value = readFileInt(BAT1_END_PATH);
            this.startLimit2Value = readFileInt(BAT1_START_PATH);
            if ((endValue === this.endLimit2Value) && (startValue === this.startLimit2Value)) {
                this.emit('threshold-applied', true);
                return 0;
            }
        }
        return 1;
    }

    async setThresholdLimitDual() {
        let status = await this.setThresholdLimit(ExtensionUtils.getSettings().get_string('charging-mode'));
        if (status === 0)
            status = await this.setThresholdLimit2(ExtensionUtils.getSettings().get_string('charging-mode2'));
        return status;
    }

    initializeBatteryMonitoring() {
        this._supportsForceDischarge = ExtensionUtils.getSettings().get_boolean('supports-force-discharge');
        if (this._supportsForceDischarge) {
            const mode = ExtensionUtils.getSettings().get_string('drain-mode');
            if (mode === 'auto')
                this.setForceDischargeMode(mode);
        }

        this._battery1LevelPath = Gio.File.new_for_path(BAT1_END_PATH);
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
            this.chargerPlugged = readFileInt(this._adpPath) === 1;
            this.battery0Level = readFileInt(BAT0_CAPACITY_PATH);
            this.battery0Status = readFile(BAT0_STATUS).trim();
            this.bat0ReadMode = readFile(BAT0_CHARGING_BEHAVIOUR).trim();

            if (this.battery1Removed) {
                this.battery1Level = 0;
                this.battery1Status = 'Removed';
                this.bat1ReadMode = 'removed';
            } else {
                this.battery1Level = readFileInt(BAT1_CAPACITY_PATH);
                this.battery1Status = readFile(BAT1_STATUS).trim();
                this.bat1ReadMode = readFile(BAT1_CHARGING_BEHAVIOUR).trim();
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
                        this.battery0Status = readFile(BAT0_STATUS).trim();
                        this.updateDischargeMode();
                    }
                    const online = readFileInt(this._adpPath) === 1;
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
                        this.battery1Status = this.battery1Removed ? 'Removed' : readFile(BAT1_STATUS).trim();
                        this.updateDischargeMode();
                    }
                });
            }
        });
    }

    _batteryStatus() {
        if (this.battery1Removed)
            this.battery1Status = 'Removed';
        this.bat0ReadMode = readFile(BAT0_CHARGING_BEHAVIOUR).trim();
        this.bat1ReadMode = this.battery1Removed ? 'removed' : readFile(BAT1_CHARGING_BEHAVIOUR).trim();

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
        this.bat0ReadMode = readFile(BAT0_CHARGING_BEHAVIOUR).trim();
        this.bat1ReadMode = this.battery1Remove ? 'removed' : readFile(BAT1_CHARGING_BEHAVIOUR).trim();
        log(`---- this.bat0ReadMode = ${this.bat0ReadMode}`);
        log(`---- this.bat1ReadMode = ${this.bat1ReadMode}`);
        if (switchMode === 'auto') {
            if (this.bat0ReadMode !== 'auto')
                await runCommandCtl('CHARGE_BEHAVIOUR0', 'auto', null, false);
            if ((this.bat1ReadMode !== 'auto') && (this.bat1ReadMode !== 'removed'))
                await runCommandCtl('CHARGE_BEHAVIOUR1', 'auto', null, false);
        } else if (switchMode === 'bat0') {
            if ((this.bat1ReadMode !== 'auto') && (this.bat1ReadMode !== 'removed'))
                await runCommandCtl('CHARGE_BEHAVIOUR1', 'auto', null, false);
            if (this.bat0ReadMode !== 'force-discharge')
                await runCommandCtl('CHARGE_BEHAVIOUR0', 'force-discharge', null, false);
        } else if (switchMode === 'bat1') {
            if (this.bat0ReadMode !== 'auto')
                await runCommandCtl('CHARGE_BEHAVIOUR0', 'auto', null, false);
            if ((this.bat1ReadMode !== 'force-discharge') && (this.bat1ReadMode !== 'removed'))
                await runCommandCtl('CHARGE_BEHAVIOUR1', 'force-discharge', null, false);
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

var ThinkpadSingleBatteryBAT0 = GObject.registerClass({
    Signals: {'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class ThinkpadSingleBatteryBAT0 extends GObject.Object {
    name = 'Thinkpad BAT0';
    type = 20;
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
    startFullCapacityRangeMax = 98;
    startFullCapacityRangeMin = 75;
    startBalancedRangeMax = 83;
    startBalancedRangeMin = 60;
    startMaxLifeSpanRangeMax = 83;
    startMaxLifeSpanRangeMin = 40;
    minDiffLimit = 2;

    isAvailable() {
        if (!fileExists(VENDOR_THINKPAD))
            return false;
        if (!fileExists(R_BAT0_START_PATH))
            return false;
        if (!fileExists(R_BAT0_END_PATH))
            return false;
        if (fileExists(R_BAT1_END_PATH))
            return false;
        return true;
    }

    async setThresholdLimit(chargingMode) {
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode}-end-threshold`);
        const startValue = settings.get_int(`current-${chargingMode}-start-threshold`);
        const oldEndValue = readFileInt(R_BAT0_END_PATH);
        const oldStartValue = readFileInt(R_BAT0_START_PATH);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimitValue = endValue;
            this.startLimitValue = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('BAT0_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('BAT0_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimitValue = readFileInt(R_BAT0_END_PATH);
            this.startLimitValue = readFileInt(R_BAT0_START_PATH);
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

var ThinkpadSingleBatteryBAT1 = GObject.registerClass({
    Signals: {'threshold-applied': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class ThinkpadSingleBatteryBAT1 extends GObject.Object {
    name = 'Thinkpad BAT1';
    type = 21;
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
    startFullCapacityRangeMax = 98;
    startFullCapacityRangeMin = 75;
    startBalancedRangeMax = 83;
    startBalancedRangeMin = 60;
    startMaxLifeSpanRangeMax = 83;
    startMaxLifeSpanRangeMin = 40;
    minDiffLimit = 2;

    isAvailable() {
        if (!fileExists(VENDOR_THINKPAD))
            return false;
        if (!fileExists(R_BAT1_START_PATH))
            return false;
        if (!fileExists(R_BAT1_END_PATH))
            return false;
        if (fileExists(R_BAT0_END_PATH))
            return false;
        return true;
    }

    async setThresholdLimit(chargingMode) {
        let status;
        const settings = ExtensionUtils.getSettings();
        const endValue = settings.get_int(`current-${chargingMode}-end-threshold`);
        const startValue = settings.get_int(`current-${chargingMode}-start-threshold`);
        const oldEndValue = readFileInt(R_BAT1_END_PATH);
        const oldStartValue = readFileInt(R_BAT1_START_PATH);
        if ((oldEndValue === endValue) && (oldStartValue === startValue)) {
            this.endLimitValue = endValue;
            this.startLimitValue = startValue;
            this.emit('threshold-applied', true);
            return 0;
        }
        // Some device wont update end threshold if start threshold > end threshold
        if (startValue >= oldEndValue)
            status = await runCommandCtl('BAT1_END_START', `${endValue}`, `${startValue}`, false);
        else
            status = await runCommandCtl('BAT1_START_END', `${endValue}`, `${startValue}`, false);
        if (status === 0) {
            this.endLimitValue = readFileInt(R_BAT1_END_PATH);
            this.startLimitValue = readFileInt(R_BAT1_START_PATH);
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

