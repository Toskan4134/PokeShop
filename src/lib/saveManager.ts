import { join } from '@tauri-apps/api/path';
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getCurrentProfile, getProfileDir } from './profileManager';

export interface SaveData {
    profileId: string; // Add profile ID to track ownership
    regions: string[];
    currentRegionIndex: number;
    selectedRegionIndex: number;
    selectedShopIndex: number;
    lastShopIndex: number;
    visitedRegions: string[];
    shop: any[];
    shopByIndex: Record<number, any[]>;
    rerollsUsedGlobal: number;
    money: number;
    history: any[];
    purchases: any[];
    undoStack: any[];
    savedAt: string;
}

const SAVE_FILE_NAME = 'save.sav';

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export async function getSaveFilePath(profileId?: string): Promise<string> {
    const currentProfileId = profileId || await getCurrentProfile();
    const profileDir = await getProfileDir(currentProfileId);
    return await join(profileDir, SAVE_FILE_NAME);
}

export async function loadSaveData(profileId?: string): Promise<SaveData | null> {
    if (!isTauri) {
        console.log(`[SaveManager] Not in Tauri mode, returning null`);
        return null;
    }

    try {
        let targetProfileId = profileId;

        // If no specific profile ID provided, check if we need special handling for auto-selected profiles
        if (!profileId) {
            try {
                const { getProfiles } = await import('./profileManager');
                const profileMetadata = await getProfiles();

                if ((profileMetadata as any)._needsProfileLoad) {
                    targetProfileId = profileMetadata.currentProfile;
                    console.log(`[SaveManager] Auto-selected profile detected, loading specific profile: ${targetProfileId}`);
                    // Clear the flag after detecting it
                    delete (profileMetadata as any)._needsProfileLoad;
                }
            } catch (err) {
                console.warn(`[SaveManager] Error checking for auto-selected profile:`, err);
            }
        }

        console.log(`[SaveManager] Loading save data for profile: ${targetProfileId || 'current'}`);
        const saveFilePath = await getSaveFilePath(targetProfileId);
        console.log(`[SaveManager] Save file path: ${saveFilePath}`);

        if (!(await exists(saveFilePath))) {
            console.log(`[SaveManager] Save file does not exist: ${saveFilePath}`);
            return null;
        }

        const content = await readTextFile(saveFilePath);
        const saveData = JSON.parse(content) as SaveData;
        console.log(`[SaveManager] Loaded save data from: ${saveFilePath}`, saveData);
        return saveData;
    } catch (err) {
        console.error(`[SaveManager] Error loading save data:`, err);
        return null;
    }
}

export async function saveSaveData(saveData: Omit<SaveData, 'savedAt'>, profileId?: string): Promise<void> {
    if (!isTauri) {
        console.log(`[SaveManager] Not in Tauri mode, skipping save`);
        return;
    }

    try {
        const targetProfileId = profileId || await getCurrentProfile();
        console.log(`[SaveManager] Saving data for profile: ${targetProfileId}`);
        const saveFilePath = await getSaveFilePath(profileId);

        const dataToSave: SaveData = {
            ...saveData,
            profileId: targetProfileId, // Ensure profile ID is always set
            savedAt: new Date().toISOString()
        };

        console.log(`[SaveManager] Writing save data to: ${saveFilePath}`);
        await writeTextFile(saveFilePath, JSON.stringify(dataToSave, null, 2));
        console.log(`[SaveManager] Save data written successfully`);
    } catch (err) {
        console.error(`[SaveManager] Error saving data:`, err);
        throw err;
    }
}

export async function deleteSaveData(profileId?: string): Promise<void> {
    if (!isTauri) {
        console.log(`[SaveManager] Not in Tauri mode, skipping delete`);
        return;
    }

    try {
        console.log(`[SaveManager] Deleting save data for profile: ${profileId || 'current'}`);
        const saveFilePath = await getSaveFilePath(profileId);

        if (await exists(saveFilePath)) {
            // We'll use remove from fs plugin
            const { remove } = await import('@tauri-apps/plugin-fs');
            await remove(saveFilePath);
            console.log(`[SaveManager] Save file deleted: ${saveFilePath}`);
        } else {
            console.log(`[SaveManager] Save file doesn't exist: ${saveFilePath}`);
        }
    } catch (err) {
        console.error(`[SaveManager] Error deleting save data:`, err);
        throw err;
    }
}