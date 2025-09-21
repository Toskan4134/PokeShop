import { appConfigDir, join } from '@tauri-apps/api/path';
import {
    copyFile,
    exists,
    mkdir,
    readDir,
    readTextFile,
    remove,
    rename,
    writeTextFile,
} from '@tauri-apps/plugin-fs';
import { DEFAULT_CONFIG, DEFAULT_POKEMON } from './config';

export interface Profile {
    id: string;
    name: string;
    created: string;
    lastUsed?: string;
}

export interface ProfileMetadata {
    profiles: Profile[];
    currentProfile: string;
}

const PROFILES_DIR = 'profiles';
const PROFILES_METADATA_FILE = 'profiles.json';
const CURRENT_PROFILE_FILE = 'current-profile.json';
const DEFAULT_PROFILE_ID = 'default';

export async function getProfilesDir(): Promise<string> {
    const configDir = await appConfigDir();
    console.log(`[ProfileManager] App config dir: ${configDir}`);
    const profilesDir = await join(configDir, PROFILES_DIR);
    console.log(`[ProfileManager] Profiles dir: ${profilesDir}`);
    return profilesDir;
}

export async function getProfileDir(profileId: string): Promise<string> {
    console.log(`[ProfileManager] getProfileDir called with profileId: ${profileId}`);
    const profilesDir = await getProfilesDir();

    // For default profile, use 'default' folder name
    if (profileId === DEFAULT_PROFILE_ID) {
        const defaultDir = await join(profilesDir, 'default');
        console.log(`[ProfileManager] Using default profile dir: ${defaultDir}`);
        return defaultDir;
    }

    // First, try to find the actual folder by scanning for save files with matching profile ID
    try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(profilesDir);

        for (const entry of entries) {
            if (entry.isDirectory) {
                const folderName = entry.name;
                const saveFilePath = await join(profilesDir, folderName, 'save.sav');

                if (await exists(saveFilePath)) {
                    try {
                        const content = await readTextFile(saveFilePath);
                        const saveData = JSON.parse(content);

                        if (saveData.profileId === profileId) {
                            const actualDir = await join(profilesDir, folderName);
                            console.log(`[ProfileManager] Found actual folder for profile ID ${profileId}: ${actualDir}`);

                            // Check if the folder name doesn't match the expected name and update profile if needed
                            try {
                                const configDir = await appConfigDir();
                                const metadataPath = await join(configDir, PROFILES_METADATA_FILE);

                                if (await exists(metadataPath)) {
                                    const content = await readTextFile(metadataPath);
                                    const metadata = JSON.parse(content) as ProfileMetadata;
                                    const profile = metadata.profiles.find(p => p.id === profileId);

                                    if (profile) {
                                        const expectedFolderName = profileId === DEFAULT_PROFILE_ID ? 'default' : sanitizeProfileName(profile.name);

                                        if (folderName !== expectedFolderName) {
                                            // Folder name has changed, update the profile name
                                            const oldProfileName = profile.name;
                                            const newProfileName = folderName === 'default' ? 'Predeterminado' : folderName.replace(/_/g, ' ');
                                            profile.name = newProfileName;

                                            await saveProfileMetadata(metadata);
                                            console.log(`[ProfileManager] Updated profile name from "${oldProfileName}" to "${newProfileName}" due to folder rename`);

                                            // Trigger a custom event to notify UI components
                                            if (typeof window !== 'undefined') {
                                                window.dispatchEvent(new CustomEvent('profileUpdated', {
                                                    detail: { profileId, oldName: oldProfileName, newName: newProfileName }
                                                }));
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                console.warn(`[ProfileManager] Error updating profile name during getProfileDir:`, err);
                            }

                            return actualDir;
                        }
                    } catch (err) {
                        console.warn(`[ProfileManager] Error reading save file in ${folderName}:`, err);
                    }
                }
            }
        }
    } catch (err) {
        console.warn(`[ProfileManager] Error scanning for actual profile folder:`, err);
    }

    // Fallback: try to get from metadata (legacy behavior)
    try {
        const configDir = await appConfigDir();
        const metadataPath = await join(configDir, PROFILES_METADATA_FILE);

        if (await exists(metadataPath)) {
            const content = await readTextFile(metadataPath);
            const metadata = JSON.parse(content) as ProfileMetadata;
            const profile = metadata.profiles.find(p => p.id === profileId);

            if (profile) {
                const profileDir = await join(profilesDir, sanitizeProfileName(profile.name));
                console.log(`[ProfileManager] Fallback: using dir based on profile name: ${profileDir} for profile: ${profile.name}`);
                return profileDir;
            }
        }
    } catch (err) {
        console.warn(`[ProfileManager] Error reading metadata:`, err);
    }

    const fallbackDir = await join(profilesDir, profileId);
    console.log(`[ProfileManager] Using fallback dir: ${fallbackDir}`);
    return fallbackDir;
}

export async function ensureProfilesStructure(): Promise<void> {
    console.log(`[ProfileManager] ensureProfilesStructure called`);
    const configDir = await appConfigDir();
    const profilesDir = await getProfilesDir();

    console.log(`[ProfileManager] Creating profiles directory: ${profilesDir}`);
    await mkdir(profilesDir, { recursive: true });

    const metadataPath = await join(configDir, PROFILES_METADATA_FILE);
    const currentProfilePath = await join(configDir, CURRENT_PROFILE_FILE);

    if (!(await exists(metadataPath))) {
        console.log(`[ProfileManager] Creating initial profiles metadata`);
        const defaultMetadata: ProfileMetadata = {
            profiles: [{
                id: DEFAULT_PROFILE_ID,
                name: 'Predeterminado',
                created: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            }],
            currentProfile: DEFAULT_PROFILE_ID
        };
        await writeTextFile(metadataPath, JSON.stringify(defaultMetadata, null, 2));
    } else {
        console.log(`[ProfileManager] Profiles metadata already exists`);
    }

    if (!(await exists(currentProfilePath))) {
        console.log(`[ProfileManager] Creating current profile file`);
        await writeTextFile(currentProfilePath, JSON.stringify({ profile: DEFAULT_PROFILE_ID }, null, 2));
    } else {
        console.log(`[ProfileManager] Current profile file already exists`);
    }

    await ensureDefaultProfile();
}

export async function ensureDefaultProfile(): Promise<void> {
    console.log(`[ProfileManager] ensureDefaultProfile called`);
    const configDir = await appConfigDir();
    const metadataPath = await join(configDir, PROFILES_METADATA_FILE);

    // If profiles metadata doesn't exist, we're in initial setup - create default profile
    if (!(await exists(metadataPath))) {
        console.log(`[ProfileManager] Initial setup - creating default profile folder`);
        const profilesDir = await getProfilesDir();
        const defaultProfileDir = await join(profilesDir, 'default');
        await mkdir(defaultProfileDir, { recursive: true });

        const configPath = await join(defaultProfileDir, 'config.json');
        const pokemonPath = await join(defaultProfileDir, 'pokemon.json');
        const spritesDir = await join(defaultProfileDir, 'sprites');

        if (!(await exists(configPath))) {
            console.log(`[ProfileManager] Creating default config.json`);
            await writeTextFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
        }

        if (!(await exists(pokemonPath))) {
            console.log(`[ProfileManager] Creating default pokemon.json`);
            await writeTextFile(pokemonPath, JSON.stringify(DEFAULT_POKEMON, null, 2));
        }

        console.log(`[ProfileManager] Creating default sprites directory`);
        await mkdir(spritesDir, { recursive: true });

        const readmePath = await join(spritesDir, 'LEEME.txt');
        if (!(await exists(readmePath))) {
            console.log(`[ProfileManager] Creating default sprites README`);
            await writeTextFile(
                readmePath,
                [
                    'Pon aquí tus sprites personalizados como PNG llamados por ID:',
                    '1.png, 2.png, 25.png, 001.png (también se acepta).',
                ].join('\n')
            );
        }
    } else {
        console.log(`[ProfileManager] Metadata exists - skipping default profile creation`);
    }
}

export async function detectAndRegisterManualProfiles(): Promise<boolean> {
    console.log(`[ProfileManager] detectAndRegisterManualProfiles called - performing full sync`);
    try {
        const profilesDir = await getProfilesDir();

        // Check if profiles directory exists
        if (!(await exists(profilesDir))) {
            console.log(`[ProfileManager] Profiles directory does not exist, skipping auto-detection`);
            return false;
        }

        const configDir = await appConfigDir();
        const metadataPath = await join(configDir, PROFILES_METADATA_FILE);

        // Load existing metadata
        let metadata: ProfileMetadata;
        try {
            const content = await readTextFile(metadataPath);
            metadata = JSON.parse(content) as ProfileMetadata;
        } catch {
            // If metadata doesn't exist, create default
            metadata = {
                profiles: [{
                    id: DEFAULT_PROFILE_ID,
                    name: 'Predeterminado',
                    created: new Date().toISOString()
                }],
                currentProfile: DEFAULT_PROFILE_ID
            };
        }

        // Read all directories in profiles folder
        const entries = await readDir(profilesDir);
        const validFolders = new Set<string>();
        const newProfiles: Profile[] = [];

        // Step 1: Find all valid profile folders (containing save.sav) and read their profile IDs
        const folderToProfileId = new Map<string, string>();
        for (const entry of entries) {
            if (entry.isDirectory) {
                const folderName = entry.name;
                const folderPath = await join(profilesDir, folderName);
                const saveFilePath = await join(folderPath, 'save.sav');

                // Check if this directory has a save.sav file (required for detection)
                if (await exists(saveFilePath)) {
                    try {
                        // Read the save file to get the profile ID
                        const content = await readTextFile(saveFilePath);
                        const saveData = JSON.parse(content);
                        const savedProfileId = saveData.profileId;

                        if (savedProfileId) {
                            validFolders.add(folderName);
                            folderToProfileId.set(folderName, savedProfileId);
                            console.log(`[ProfileManager] Found valid profile folder: "${folderName}" with profile ID: ${savedProfileId}`);
                        } else {
                            // Legacy save file without profile ID - treat as new profile
                            validFolders.add(folderName);
                            console.log(`[ProfileManager] Found valid profile folder: "${folderName}" (legacy, no profile ID)`);
                        }
                    } catch (err) {
                        console.warn(`[ProfileManager] Error reading save file in "${folderName}":`, err);
                        // Still consider it valid if save file exists but can't be read
                        validFolders.add(folderName);
                        console.log(`[ProfileManager] Found valid profile folder: "${folderName}" (corrupted save file)`);
                    }
                } else {
                    console.log(`[ProfileManager] Directory "${folderName}" found but no save.sav file - not a valid profile`);
                }
            }
        }

        // Step 2: Check existing profiles and match them with folders by profile ID or folder name
        const validProfiles: Profile[] = [];
        const processedFolders = new Set<string>();
        let hasProfileNameChanges = false;

        for (const profile of metadata.profiles) {
            let matchedFolder: string | null = null;

            // First, try to match by profile ID from save files (highest priority)
            for (const [folderName, savedProfileId] of folderToProfileId.entries()) {
                if (savedProfileId === profile.id && !processedFolders.has(folderName)) {
                    matchedFolder = folderName;
                    console.log(`[ProfileManager] Matched profile "${profile.name}" to folder "${folderName}" by profile ID`);
                    break;
                }
            }

            // If no ID match, try to match by expected folder name (for legacy compatibility)
            if (!matchedFolder) {
                const expectedFolderName = profile.id === DEFAULT_PROFILE_ID ? 'default' : sanitizeProfileName(profile.name);
                if (validFolders.has(expectedFolderName) && !processedFolders.has(expectedFolderName)) {
                    matchedFolder = expectedFolderName;
                    console.log(`[ProfileManager] Matched profile "${profile.name}" to expected folder "${expectedFolderName}"`);
                }
            }

            if (matchedFolder) {
                // Check if the folder name has changed and update the profile name accordingly
                const expectedFolderName = profile.id === DEFAULT_PROFILE_ID ? 'default' : sanitizeProfileName(profile.name);
                let updatedProfile = profile;

                if (matchedFolder !== expectedFolderName) {
                    // Folder name has changed, update the profile name to match
                    const newProfileName = matchedFolder === 'default' ? 'Predeterminado' : matchedFolder.replace(/_/g, ' ');
                    updatedProfile = {
                        ...profile,
                        name: newProfileName
                    };
                    hasProfileNameChanges = true;
                    console.log(`[ProfileManager] Updated profile name from "${profile.name}" to "${newProfileName}" to match folder "${matchedFolder}"`);
                }

                validProfiles.push(updatedProfile);
                validFolders.delete(matchedFolder);
                processedFolders.add(matchedFolder);
                console.log(`[ProfileManager] Keeping existing profile: "${updatedProfile.name}" (folder: "${matchedFolder}")`);
            } else {
                // Keep the profile even if no folder is found - it might have been moved/renamed
                // The profile will be preserved in metadata but won't have an active folder
                validProfiles.push(profile);
                console.log(`[ProfileManager] Keeping profile without folder: "${profile.name}" (folder may have been moved/renamed)`);
            }
        }

        // Step 3: Add new profiles for remaining unprocessed folders
        for (const folderName of validFolders) {
            const profileName = folderName === 'default' ? 'Predeterminado' : folderName.replace(/_/g, ' ');

            // Use the profile ID from the save file if available, otherwise generate new one
            let newProfileId: string;
            const savedProfileId = folderToProfileId.get(folderName);

            if (savedProfileId) {
                newProfileId = savedProfileId;
                console.log(`[ProfileManager] Adding profile: "${profileName}" from folder "${folderName}" with existing ID: ${savedProfileId}`);
            } else {
                newProfileId = folderName === 'default' ? DEFAULT_PROFILE_ID : generateProfileId();
                console.log(`[ProfileManager] Adding new profile: "${profileName}" from folder "${folderName}" with new ID: ${newProfileId}`);
            }

            const newProfile: Profile = {
                id: newProfileId,
                name: profileName,
                created: new Date().toISOString()
            };

            newProfiles.push(newProfile);
        }

        // Step 4: Update metadata if changes were made
        const hasChanges = validProfiles.length !== metadata.profiles.length || newProfiles.length > 0 || hasProfileNameChanges;

        if (hasChanges) {
            metadata.profiles = [...validProfiles, ...newProfiles];
            console.log(`[ProfileManager] Metadata updated due to changes: profiles count: ${validProfiles.length + newProfiles.length}, name changes: ${hasProfileNameChanges}`);
        }

        // Always ensure there's an active profile selected
        const currentProfileExists = metadata.profiles.some(p => p.id === metadata.currentProfile);
        let needsCurrentProfileUpdate = false;
        let needsProfileLoad = false;

        if (!currentProfileExists || !metadata.currentProfile) {
            if (metadata.profiles.length > 0) {
                console.log(`[ProfileManager] No valid current profile, switching to: "${metadata.profiles[0].name}"`);
                metadata.currentProfile = metadata.profiles[0].id;
                needsCurrentProfileUpdate = true;
                needsProfileLoad = true; // Flag that we need to load this profile's data
            } else {
                console.warn(`[ProfileManager] No profiles available to set as current`);
            }
        }

        // Save metadata if there were changes or current profile needed updating
        if (hasChanges || needsCurrentProfileUpdate) {
            console.log(`[ProfileManager] Saving updated metadata: ${validProfiles.length} existing + ${newProfiles.length} new profiles, current: ${metadata.currentProfile}`);
            await saveProfileMetadata(metadata);

            // Also update the current-profile.json file to ensure consistency
            if (needsCurrentProfileUpdate) {
                const configDir = await appConfigDir();
                const currentProfilePath = await join(configDir, CURRENT_PROFILE_FILE);
                await writeTextFile(currentProfilePath, JSON.stringify({ profile: metadata.currentProfile }, null, 2));
                console.log(`[ProfileManager] Updated current profile file to: ${metadata.currentProfile}`);
            }
        } else {
            console.log(`[ProfileManager] No changes detected in profile sync`);
        }

        // Return flag indicating if we need to reload the current profile
        return needsProfileLoad;
    } catch (err) {
        console.warn(`[ProfileManager] Error during profile sync:`, err);
        return false;
    }
}

export async function getProfiles(): Promise<ProfileMetadata> {
    await ensureProfilesStructure();

    const configDir = await appConfigDir();
    const metadataPath = await join(configDir, PROFILES_METADATA_FILE);

    let metadata: ProfileMetadata;
    try {
        const content = await readTextFile(metadataPath);
        metadata = JSON.parse(content) as ProfileMetadata;
    } catch {
        metadata = {
            profiles: [{
                id: DEFAULT_PROFILE_ID,
                name: 'Predeterminado',
                created: new Date().toISOString()
            }],
            currentProfile: DEFAULT_PROFILE_ID
        };
    }

    // Ensure there's always a valid current profile
    if (!metadata.currentProfile || !metadata.profiles.some(p => p.id === metadata.currentProfile)) {
        if (metadata.profiles.length > 0) {
            console.log(`[ProfileManager] Invalid current profile, setting to first available: "${metadata.profiles[0].name}"`);
            metadata.currentProfile = metadata.profiles[0].id;

            // Save the corrected metadata
            await saveProfileMetadata(metadata);

            // Also update current-profile.json
            const currentProfilePath = await join(configDir, CURRENT_PROFILE_FILE);
            await writeTextFile(currentProfilePath, JSON.stringify({ profile: metadata.currentProfile }, null, 2));

            // Add flag to metadata to indicate this profile was auto-selected
            (metadata as any)._needsProfileLoad = true;
        }
    }

    return metadata;
}

export async function getCurrentProfile(): Promise<string> {
    console.log(`[ProfileManager] getCurrentProfile called`);
    await ensureProfilesStructure();

    const configDir = await appConfigDir();
    const currentProfilePath = await join(configDir, CURRENT_PROFILE_FILE);

    try {
        const content = await readTextFile(currentProfilePath);
        const data = JSON.parse(content);
        let profileId = data.profile || DEFAULT_PROFILE_ID;

        // Verify that the current profile actually exists in metadata (without calling getProfiles to avoid circular dependency)
        const metadataPath = await join(configDir, PROFILES_METADATA_FILE);
        let profileExists = true;

        try {
            const metadataContent = await readTextFile(metadataPath);
            const metadata = JSON.parse(metadataContent) as ProfileMetadata;
            profileExists = metadata.profiles.some(p => p.id === profileId);
        } catch {
            // If metadata can't be read, assume profile exists to avoid issues
            profileExists = true;
        }

        if (!profileExists) {
            console.warn(`[ProfileManager] Current profile ${profileId} doesn't exist, switching to first available`);
            try {
                const metadataContent = await readTextFile(metadataPath);
                const metadata = JSON.parse(metadataContent) as ProfileMetadata;
                if (metadata.profiles.length > 0) {
                    profileId = metadata.profiles[0].id;
                    // Update the current profile file
                    await writeTextFile(currentProfilePath, JSON.stringify({ profile: profileId }, null, 2));
                    console.log(`[ProfileManager] Updated current profile to: ${profileId}`);
                } else {
                    profileId = DEFAULT_PROFILE_ID;
                }
            } catch {
                profileId = DEFAULT_PROFILE_ID;
            }
        }

        console.log(`[ProfileManager] Current profile: ${profileId}`);
        return profileId;
    } catch (err) {
        console.warn(`[ProfileManager] Error reading current profile, getting from metadata`, err);

        // Fallback: get from metadata
        try {
            const metadata = await getProfiles();
            const profileId = metadata.currentProfile || (metadata.profiles.length > 0 ? metadata.profiles[0].id : DEFAULT_PROFILE_ID);

            // Try to save it back to current profile file
            await writeTextFile(currentProfilePath, JSON.stringify({ profile: profileId }, null, 2));
            console.log(`[ProfileManager] Restored current profile file with: ${profileId}`);
            return profileId;
        } catch {
            console.warn(`[ProfileManager] Complete fallback to default profile`);
            return DEFAULT_PROFILE_ID;
        }
    }
}

export async function setCurrentProfile(profileId: string): Promise<void> {
    console.log(`[ProfileManager] setCurrentProfile called with: ${profileId}`);
    const metadata = await getProfiles();
    const profile = metadata.profiles.find(p => p.id === profileId);

    if (!profile) {
        console.error(`[ProfileManager] Profile not found: ${profileId}`);
        throw new Error(`Profile ${profileId} not found`);
    }

    const configDir = await appConfigDir();
    const currentProfilePath = await join(configDir, CURRENT_PROFILE_FILE);

    console.log(`[ProfileManager] Writing current profile to: ${currentProfilePath}`);
    await writeTextFile(currentProfilePath, JSON.stringify({ profile: profileId }, null, 2));

    profile.lastUsed = new Date().toISOString();
    console.log(`[ProfileManager] Updated lastUsed for profile: ${profile.name}`);
    await saveProfileMetadata(metadata);
}

export async function createProfile(name: string, copyFromProfile?: string): Promise<string> {
    console.log(`[ProfileManager] createProfile called with name: "${name}", copyFrom: ${copyFromProfile || 'none'}`);
    const metadata = await getProfiles();

    if (metadata.profiles.some(p => p.name === name)) {
        console.error(`[ProfileManager] Profile name already exists: ${name}`);
        throw new Error(`Profile with name "${name}" already exists`);
    }

    const profileId = generateProfileId();
    console.log(`[ProfileManager] Generated profile ID: ${profileId}`);

    // Create directory using the profile name directly
    const profilesDir = await getProfilesDir();
    const folderName = sanitizeProfileName(name);
    const profileDir = await join(profilesDir, folderName);

    console.log(`[ProfileManager] Creating profile directory: ${profileDir}`);
    await mkdir(profileDir, { recursive: true });

    if (copyFromProfile) {
        // User wants to copy from an existing profile
        let sourceProfileDir: string;
        if (copyFromProfile === DEFAULT_PROFILE_ID) {
            sourceProfileDir = await join(profilesDir, 'default');
        } else {
            const sourceProfile = metadata.profiles.find(p => p.id === copyFromProfile);
            if (sourceProfile) {
                sourceProfileDir = await join(profilesDir, sanitizeProfileName(sourceProfile.name));
            } else {
                sourceProfileDir = await join(profilesDir, copyFromProfile);
            }
        }

        if (await exists(sourceProfileDir)) {
            await copyProfileFiles(sourceProfileDir, profileDir);
        } else {
            await createDefaultProfileFiles(profileDir);
        }
    } else {
        // User wants to create an empty profile - just create default files
        await createDefaultProfileFiles(profileDir);
    }

    const newProfile: Profile = {
        id: profileId,
        name,
        created: new Date().toISOString()
    };

    metadata.profiles.push(newProfile);
    await saveProfileMetadata(metadata);

    return profileId;
}

export async function renameProfile(profileId: string, newName: string): Promise<void> {
    const metadata = await getProfiles();
    const profile = metadata.profiles.find(p => p.id === profileId);

    if (!profile) {
        throw new Error(`Profile ${profileId} not found`);
    }

    if (metadata.profiles.some(p => p.name === newName && p.id !== profileId)) {
        throw new Error(`Profile with name "${newName}" already exists`);
    }

    const oldFolderName = sanitizeProfileName(profile.name);
    const newFolderName = sanitizeProfileName(newName);

    // Rename folder if the sanitized name changes
    if (oldFolderName !== newFolderName) {
        const profilesDir = await getProfilesDir();
        const oldPath = await join(profilesDir, oldFolderName);
        const newPath = await join(profilesDir, newFolderName);

        if (await exists(oldPath)) {
            await rename(oldPath, newPath);
        }
    }

    profile.name = newName;
    await saveProfileMetadata(metadata);
}

export async function duplicateProfile(profileId: string, newName: string): Promise<string> {
    console.log(`[ProfileManager] duplicateProfile called with name: "${newName}", sourceProfile: ${profileId}`);
    const metadata = await getProfiles();
    const sourceProfile = metadata.profiles.find(p => p.id === profileId);

    if (!sourceProfile) {
        throw new Error(`Profile ${profileId} not found`);
    }

    if (metadata.profiles.some(p => p.name === newName)) {
        console.error(`[ProfileManager] Profile name already exists: ${newName}`);
        throw new Error(`Profile with name "${newName}" already exists`);
    }

    const newProfileId = generateProfileId();
    console.log(`[ProfileManager] Generated profile ID: ${newProfileId}`);

    // Create directory using the profile name directly
    const profilesDir = await getProfilesDir();
    const folderName = sanitizeProfileName(newName);
    const profileDir = await join(profilesDir, folderName);

    console.log(`[ProfileManager] Creating profile directory: ${profileDir}`);
    await mkdir(profileDir, { recursive: true });

    // Get source profile directory
    let sourceProfileDir: string;
    if (profileId === DEFAULT_PROFILE_ID) {
        sourceProfileDir = await join(profilesDir, 'default');
    } else {
        sourceProfileDir = await join(profilesDir, sanitizeProfileName(sourceProfile.name));
    }

    // Copy everything including save file for duplication
    if (await exists(sourceProfileDir)) {
        await copyProfileFilesWithSave(sourceProfileDir, profileDir);
    } else {
        await createDefaultProfileFiles(profileDir);
    }

    const newProfile: Profile = {
        id: newProfileId,
        name: newName,
        created: new Date().toISOString()
    };

    metadata.profiles.push(newProfile);
    await saveProfileMetadata(metadata);

    return newProfileId;
}

export async function deleteProfile(profileId: string): Promise<void> {
    const metadata = await getProfiles();

    // Prevent deletion of last remaining profile
    if (metadata.profiles.length <= 1) {
        throw new Error('Cannot delete the last remaining profile');
    }

    const profileIndex = metadata.profiles.findIndex(p => p.id === profileId);

    if (profileIndex === -1) {
        throw new Error(`Profile ${profileId} not found`);
    }

    const profile = metadata.profiles[profileIndex];
    const profilesDir = await getProfilesDir();
    const folderName = sanitizeProfileName(profile.name);
    const profileDir = await join(profilesDir, folderName);

    if (await exists(profileDir)) {
        await remove(profileDir, { recursive: true });
    }

    metadata.profiles.splice(profileIndex, 1);

    // If deleting current profile, switch to first remaining profile
    if (metadata.currentProfile === profileId) {
        const newCurrentProfile = metadata.profiles[0].id;
        metadata.currentProfile = newCurrentProfile;
        await setCurrentProfile(newCurrentProfile);
    }

    await saveProfileMetadata(metadata);
}

async function saveProfileMetadata(metadata: ProfileMetadata): Promise<void> {
    const configDir = await appConfigDir();
    const metadataPath = await join(configDir, PROFILES_METADATA_FILE);
    await writeTextFile(metadataPath, JSON.stringify(metadata, null, 2));
}

async function copyProfileFiles(sourceDir: string, targetDir: string): Promise<void> {
    const files = ['config.json', 'pokemon.json'];

    for (const file of files) {
        const sourcePath = await join(sourceDir, file);
        const targetPath = await join(targetDir, file);

        if (await exists(sourcePath)) {
            await copyFile(sourcePath, targetPath);
        }
    }

    const sourceSpritesDir = await join(sourceDir, 'sprites');
    const targetSpritesDir = await join(targetDir, 'sprites');

    await mkdir(targetSpritesDir, { recursive: true });

    if (await exists(sourceSpritesDir)) {
        try {
            const entries = await readDir(sourceSpritesDir);
            for (const entry of entries) {
                if (entry.isFile) {
                    const sourcePath = await join(sourceSpritesDir, entry.name);
                    const targetPath = await join(targetSpritesDir, entry.name);
                    await copyFile(sourcePath, targetPath);
                }
            }
        } catch {
            // Ignore errors when copying sprites
        }
    }

    const readmePath = await join(targetSpritesDir, 'LEEME.txt');
    if (!(await exists(readmePath))) {
        await writeTextFile(
            readmePath,
            [
                'Pon aquí tus sprites personalizados como PNG llamados por ID:',
                '1.png, 2.png, 25.png, 001.png (también se acepta).',
                'Sobrescriben a /sprites-default/{id}.png',
            ].join('\n')
        );
    }
}

async function copyProfileFilesWithSave(sourceDir: string, targetDir: string): Promise<void> {
    // Copy all standard files including save file
    const files = ['config.json', 'pokemon.json', 'save.sav'];

    for (const file of files) {
        const sourcePath = await join(sourceDir, file);
        const targetPath = await join(targetDir, file);

        if (await exists(sourcePath)) {
            await copyFile(sourcePath, targetPath);
        }
    }

    const sourceSpritesDir = await join(sourceDir, 'sprites');
    const targetSpritesDir = await join(targetDir, 'sprites');

    await mkdir(targetSpritesDir, { recursive: true });

    if (await exists(sourceSpritesDir)) {
        try {
            const entries = await readDir(sourceSpritesDir);
            for (const entry of entries) {
                if (entry.isFile) {
                    const sourcePath = await join(sourceSpritesDir, entry.name);
                    const targetPath = await join(targetSpritesDir, entry.name);
                    await copyFile(sourcePath, targetPath);
                }
            }
        } catch {
            // Ignore errors when copying sprites
        }
    }

    const readmePath = await join(targetSpritesDir, 'LEEME.txt');
    if (!(await exists(readmePath))) {
        await writeTextFile(
            readmePath,
            [
                'Pon aquí tus sprites personalizados como PNG llamados por ID:',
                '1.png, 2.png, 25.png, 001.png (también se acepta).',
                'Sobrescriben a /sprites-default/{id}.png',
            ].join('\n')
        );
    }
}

async function createDefaultProfileFiles(profileDir: string): Promise<void> {
    const configPath = await join(profileDir, 'config.json');
    const pokemonPath = await join(profileDir, 'pokemon.json');
    const spritesDir = await join(profileDir, 'sprites');

    await writeTextFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    await writeTextFile(pokemonPath, JSON.stringify(DEFAULT_POKEMON, null, 2));

    await mkdir(spritesDir, { recursive: true });

    const readmePath = await join(spritesDir, 'LEEME.txt');
    await writeTextFile(
        readmePath,
        [
            'Pon aquí tus sprites personalizados como PNG llamados por ID:',
            '1.png, 2.png, 25.png, 001.png (también se acepta).',
            'Sobrescriben a /sprites-default/{id}.png',
        ].join('\n')
    );
}

function sanitizeProfileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function generateProfileId(): string {
    return crypto.randomUUID();
}

export async function migrateExistingConfig(): Promise<void> {
    await ensureProfilesStructure();

    const configDir = await appConfigDir();
    const oldConfigPath = await join(configDir, 'config.json');
    const oldPokemonPath = await join(configDir, 'pokemon.json');
    const oldSpritesDir = await join(configDir, 'sprites');

    // Use direct path construction to avoid recursion
    const profilesDir = await getProfilesDir();
    const defaultProfileDir = await join(profilesDir, 'default');
    await mkdir(defaultProfileDir, { recursive: true });

    const newConfigPath = await join(defaultProfileDir, 'config.json');
    const newPokemonPath = await join(defaultProfileDir, 'pokemon.json');
    const newSpritesDir = await join(defaultProfileDir, 'sprites');

    let migrated = false;

    if ((await exists(oldConfigPath)) && !(await exists(newConfigPath))) {
        await copyFile(oldConfigPath, newConfigPath);
        await remove(oldConfigPath);
        migrated = true;
    }

    if ((await exists(oldPokemonPath)) && !(await exists(newPokemonPath))) {
        await copyFile(oldPokemonPath, newPokemonPath);
        await remove(oldPokemonPath);
        migrated = true;
    }

    if ((await exists(oldSpritesDir)) && !(await exists(newSpritesDir))) {
        await rename(oldSpritesDir, newSpritesDir);
        migrated = true;
    }

    if (migrated) {
        console.log('Migrated existing configuration to default profile');
    }
}