import { type Settings } from './settings.js';
export declare function createSettingsPanel(read: () => Settings, apply: (settings: Settings) => void): {
    open(): void;
};
