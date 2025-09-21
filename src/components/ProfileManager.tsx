import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    createProfile,
    deleteProfile,
    detectAndRegisterManualProfiles,
    duplicateProfile,
    getCurrentProfile,
    getProfiles,
    renameProfile,
    setCurrentProfile,
    type Profile,
} from '../lib/profileManager';
import { useShopStore } from '../store/useShopStore';

export default function ProfileManager() {
    const [isOpen, setIsOpen] = useState(false);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [currentProfileId, setCurrentProfileId] = useState<string>('');
    const [newProfileName, setNewProfileName] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [copyFromProfile, setCopyFromProfile] = useState<string>('');
    const [editingProfile, setEditingProfile] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [error, setError] = useState<string>('');
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({
        top: 0,
        left: 0,
    });

    const refreshForProfileSwitch = useShopStore(
        (s) => s.refreshForProfileSwitch
    );

    const loadProfiles = async () => {
        console.log(`[ProfileManager UI] loadProfiles called`);
        try {
            setError('');

            console.log(
                `[ProfileManager UI] Loading profiles and current profile...`
            );
            const [profileData, currentId] = await Promise.all([
                getProfiles(),
                getCurrentProfile(),
            ]);

            console.log(
                `[ProfileManager UI] Loaded ${profileData.profiles.length} profiles, current: ${currentId}`
            );
            setProfiles(profileData.profiles);
            setCurrentProfileId(currentId);

            // Note: Auto-selected profile loading is now handled in the bootstrap function
        } catch (err: any) {
            const errorMessage = err?.message || 'Error cargando perfiles';
            console.error(`[ProfileManager UI] Error loading profiles:`, err);
            setError(errorMessage);

            // Fallback: set empty state to prevent infinite loading
            setProfiles([]);
            setCurrentProfileId('');
        }
    };

    useEffect(() => {
        loadProfiles();

        // Listen for profile updates from save operations
        const handleProfileUpdate = (event: CustomEvent) => {
            console.log(`[ProfileManager UI] Profile updated via save operation:`, event.detail);
            loadProfiles(); // Refresh the profile list
        };

        window.addEventListener('profileUpdated', handleProfileUpdate as EventListener);

        return () => {
            window.removeEventListener('profileUpdated', handleProfileUpdate as EventListener);
        };
    }, []);

    const toggleDropdown = async () => {
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + 8,
                left: rect.right - 320, // 320px is the dropdown width
            });

            // Detect manually added profiles when opening dropdown
            console.log(`[ProfileManager UI] Detecting manually added profiles...`);
            try {
                const needsProfileLoad = await detectAndRegisterManualProfiles();
                // Refresh profile list to show any newly detected profiles
                await loadProfiles();

                // If a new current profile was set, we need to reload the store with that profile's data
                if (needsProfileLoad) {
                    console.log(`[ProfileManager UI] New current profile detected, reloading store...`);
                    const currentId = await getCurrentProfile();
                    await refreshForProfileSwitch(undefined, currentId);
                    console.log(`[ProfileManager UI] Store reloaded with current profile data`);
                }
            } catch (err) {
                console.warn(`[ProfileManager UI] Error during profile detection:`, err);
            }
        }
        setIsOpen(!isOpen);
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen) {
                const target = event.target as Node;
                const isClickOnButton = buttonRef.current?.contains(target);
                const isClickOnDropdown = dropdownRef.current?.contains(target);

                if (!isClickOnButton && !isClickOnDropdown) {
                    setIsOpen(false);
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () =>
            document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleSwitchProfile = async (profileId: string) => {
        console.log(`[ProfileManager UI] Switching to profile: ${profileId}`);
        try {
            setError('');

            // Store the old profile ID before switching
            const oldProfileId = currentProfileId;
            console.log(
                `[ProfileManager UI] Old profile: ${oldProfileId}, New profile: ${profileId}`
            );

            await setCurrentProfile(profileId);
            setCurrentProfileId(profileId);
            setIsOpen(false);
            console.log(
                `[ProfileManager UI] Profile switched, refreshing store...`
            );

            // Pass the old profile ID so the store can save to the correct profile
            await refreshForProfileSwitch(oldProfileId, profileId);
            console.log(`[ProfileManager UI] Profile switch completed`);
        } catch (err) {
            console.error(`[ProfileManager UI] Error switching profile:`, err);
            setError('Error switching profile');
        }
    };

    const handleCreateProfile = async () => {
        if (!newProfileName.trim()) return;

        console.log(
            `[ProfileManager UI] Creating profile: "${newProfileName.trim()}", copyFrom: ${
                copyFromProfile || 'none'
            }`
        );
        try {
            setError('');
            await createProfile(
                newProfileName.trim(),
                copyFromProfile || undefined
            );
            console.log(`[ProfileManager UI] Profile created successfully`);
            setNewProfileName('');
            setCopyFromProfile('');
            setShowCreateForm(false);
            await loadProfiles();
        } catch (err: any) {
            console.error(`[ProfileManager UI] Error creating profile:`, err);
            setError(err.message || 'Error creando perfil');
        }
    };

    const handleRenameProfile = async (profileId: string) => {
        if (!editName.trim()) return;

        try {
            setError('');
            await renameProfile(profileId, editName.trim());
            setEditingProfile(null);
            setEditName('');
            await loadProfiles();
        } catch (err: any) {
            setError(err.message || 'Error renombrando perfil');
        }
    };

    const handleDuplicateProfile = async (profileId: string) => {
        const profile = profiles.find((p) => p.id === profileId);
        const newName = prompt(
            `Introduce el nombre para el perfil duplicado:`,
            `${profile?.name} Copia`
        );

        if (!newName?.trim()) return;

        try {
            setError('');
            await duplicateProfile(profileId, newName.trim());
            await loadProfiles();
        } catch (err: any) {
            setError(err.message || 'Error duplicando perfil');
        }
    };

    const handleDeleteProfile = async (profileId: string) => {
        const profile = profiles.find((p) => p.id === profileId);

        // Prevent deletion of current profile
        if (profileId === currentProfileId) {
            setError(
                'No se puede eliminar el perfil activo. Cambia a otro perfil primero.'
            );
            return;
        }

        if (
            !confirm(
                `¿Estás seguro de que quieres eliminar el perfil "${profile?.name}"? Esta acción no se puede deshacer.`
            )
        ) {
            return;
        }

        try {
            setError('');
            await deleteProfile(profileId);
            await loadProfiles();
        } catch (err: any) {
            setError(err.message || 'Error eliminando perfil');
        }
    };

    const currentProfile = profiles.find((p) => p.id === currentProfileId);

    const dropdown = isOpen ? (
        <div
            ref={dropdownRef}
            className='w-80 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-[99999]'
            style={{
                position: 'fixed',
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
            }}
        >
            <div className='p-4'>
                <h3 className='text-lg font-bold text-neutral-100 mb-3'>
                    Perfiles
                </h3>

                {error && (
                    <div className='text-red-400 text-sm mb-3 p-2 bg-red-400/10 rounded'>
                        {error}
                    </div>
                )}

                <div className='space-y-2 mb-4 max-h-72 overflow-y-auto customScroll'>
                    {profiles.map((profile) => (
                        <div
                            key={profile.id}
                            className={`p-3 rounded border ${
                                profile.id === currentProfileId
                                    ? 'bg-blue-600/20 border-blue-500'
                                    : 'bg-neutral-800 border-neutral-600'
                            }`}
                        >
                            <div className='flex items-center justify-between'>
                                {editingProfile === profile.id ? (
                                    <div className='flex-1 flex items-center gap-2'>
                                        <input
                                            type='text'
                                            value={editName}
                                            onChange={(e) =>
                                                setEditName(e.target.value)
                                            }
                                            className='flex-1 px-2 py-1 text-sm bg-neutral-700 border border-neutral-600 rounded text-neutral-100'
                                            placeholder='Nombre del perfil'
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter')
                                                    handleRenameProfile(
                                                        profile.id
                                                    );
                                                if (e.key === 'Escape') {
                                                    setEditingProfile(null);
                                                    setEditName('');
                                                }
                                            }}
                                            autoFocus
                                        />
                                        <button
                                            onClick={() =>
                                                handleRenameProfile(profile.id)
                                            }
                                            className='text-green-400 hover:text-green-300'
                                            title='Guardar'
                                        >
                                            ✓
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingProfile(null);
                                                setEditName('');
                                            }}
                                            className='text-red-400 hover:text-red-300'
                                            title='Cancelar'
                                        >
                                            ✗
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className='flex-1'>
                                            <div className='font-medium text-neutral-100'>
                                                {profile.name}
                                            </div>
                                            <div className='text-xs text-neutral-400'>
                                                {profile.id ===
                                                    currentProfileId &&
                                                    '(Activo) • '}
                                                {new Date(
                                                    profile.created
                                                ).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div className='flex items-center gap-1'>
                                            {profile.id !==
                                                currentProfileId && (
                                                <button
                                                    onClick={() =>
                                                        handleSwitchProfile(
                                                            profile.id
                                                        )
                                                    }
                                                    className='text-blue-400 hover:text-blue-300 px-2 py-1 text-sm'
                                                    title='Cambiar a este perfil'
                                                >
                                                    Cambiar
                                                </button>
                                            )}
                                            <button
                                                onClick={() => {
                                                    setEditingProfile(
                                                        profile.id
                                                    );
                                                    setEditName(profile.name);
                                                }}
                                                className='text-yellow-400 hover:text-yellow-300 px-1'
                                                title='Renombrar'
                                            >
                                                ✏
                                            </button>
                                            <button
                                                onClick={() =>
                                                    handleDuplicateProfile(
                                                        profile.id
                                                    )
                                                }
                                                className='text-green-400 hover:text-green-300 px-1'
                                                title='Duplicar'
                                            >
                                                ⧉
                                            </button>
                                            {profiles.length > 1 &&
                                                profile.id !==
                                                    currentProfileId && (
                                                    <button
                                                        onClick={() =>
                                                            handleDeleteProfile(
                                                                profile.id
                                                            )
                                                        }
                                                        className='text-red-400 hover:text-red-300 px-1'
                                                        title='Borrar'
                                                    >
                                                        🗑
                                                    </button>
                                                )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {showCreateForm ? (
                    <div className='border-t border-neutral-700 pt-4'>
                        <h4 className='font-medium text-neutral-100 mb-2'>
                            Crear Nuevo Perfíl
                        </h4>
                        <div className='space-y-2'>
                            <input
                                type='text'
                                value={newProfileName}
                                onChange={(e) =>
                                    setNewProfileName(e.target.value)
                                }
                                placeholder='Nombre del perfil'
                                className='w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-neutral-100'
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter')
                                        handleCreateProfile();
                                    if (e.key === 'Escape') {
                                        setShowCreateForm(false);
                                        setNewProfileName('');
                                        setCopyFromProfile('');
                                    }
                                }}
                                autoFocus
                            />
                            <select
                                value={copyFromProfile}
                                onChange={(e) =>
                                    setCopyFromProfile(e.target.value)
                                }
                                className='w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-neutral-100'
                            >
                                <option value=''>Crear perfíl vacío</option>
                                {profiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                        Copiar de "{profile.name}"
                                    </option>
                                ))}
                            </select>
                            <div className='flex gap-2'>
                                <button
                                    onClick={handleCreateProfile}
                                    disabled={!newProfileName.trim()}
                                    className='btn w-full text-sm'
                                >
                                    Crear
                                </button>
                                <button
                                    onClick={() => {
                                        setShowCreateForm(false);
                                        setNewProfileName('');
                                        setCopyFromProfile('');
                                    }}
                                    className='btn-secondary text-sm'
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className='border-t border-neutral-700 pt-4'>
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className='btn-confirm w-full'
                        >
                            + Crear nuevo perfil
                        </button>
                    </div>
                )}

                <div className='border-t border-neutral-700 pt-4 mt-4'>
                    <button
                        onClick={() => setIsOpen(false)}
                        className='w-full btn-secondary'
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    return (
        <>
            <button
                ref={buttonRef}
                className='btn-secondary flex items-center gap-2'
                onClick={toggleDropdown}
                title='Perfiles'
            >
                👤 {currentProfile?.name || 'Perfíl'}
            </button>
            {dropdown && createPortal(dropdown, document.body)}
        </>
    );
}
