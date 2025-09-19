import { convertFileSrc } from '@tauri-apps/api/core';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';

export const SPRITES_DIRNAME = 'sprites';

const isTauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export async function ensureSpritesDir(): Promise<string> {
    const dir = await appConfigDir();
    const spritesDir = await join(dir, SPRITES_DIRNAME);
    try {
        // mkdir puede fallar sin permiso -> si pasa, se ignora (solo lectura)
        await mkdir(spritesDir, { recursive: true });
    } catch {}
    try {
        const readme = await join(spritesDir, 'LEEME.txt');
        if (!(await exists(readme))) {
            await writeTextFile(
                readme,
                [
                    'Pon aquí tus sprites personalizados como PNG llamados por ID:',
                    '1.png, 2.png, 25.png, 001.png (también se acepta).',
                    'Sobrescriben a /sprites-default/{id}.png',
                ].join('\n')
            );
        }
    } catch {}
    return spritesDir;
}

/** Abre la carpeta de sprites del usuario */
export async function openSpritesFolder(): Promise<void> {
    if (!isTauri) return;
    const spritesDir = await ensureSpritesDir();
    await openPath(spritesDir);
}

/** URL para <img src>: intenta custom (1.png o 001.png), si no, default; huecos -> empty.png */
export async function resolveSpriteUrl(
    idLike: number | string
): Promise<string> {
    // Normaliza ID
    const n = Number.parseInt(String(idLike), 10);
    if (!Number.isFinite(n) || n <= 0) return '/sprites-default/empty.png';

    // Construye candidatos: 1.png y 001.png
    const plain = `${n}.png`;
    const padded = `${String(n).padStart(3, '0')}.png`;

    // 1) Custom (carpeta de configuración del usuario)
    if (isTauri) {
        try {
            const spritesDir = await ensureSpritesDir();

            for (const name of [plain, padded]) {
                const full = await join(spritesDir, name);
                // 👇 algunos entornos necesitan permiso explícito para exists/read en $APPCONFIG/**
                // si no, lanzará "forbidden path"
                const ok = await exists(full).catch(() => false);
                console.log('exists?', full, ok);
                if (ok) {
                    // Para mostrar en <img>, convertir a asset://... (requiere assetProtocol.enable + scope)
                    return convertFileSrc(full);
                }
            }
        } catch {
            // Si hay errores de permisos o path, caemos al default
        }
    }

    // 2) Por defecto (servidos desde /public)
    // probamos 1.png y 001.png por si tus assets por defecto van con padding
    // (el onError de <img> cambiará a missing.png si tampoco existen)
    return `/sprites-default/${padded}`;
}
