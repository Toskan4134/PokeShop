import { useEffect, useState } from 'react';
import { openConfigFolder } from '../lib/config';
import { useShopStore } from '../store/useShopStore';

export default function SettingsPanel() {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('0');
    const addMoney = useShopStore((s) => s.addMoney);
    const cfg = useShopStore((s) => s.cfg);
    const resetAll = useShopStore((s) => s.resetAll);

    useEffect(() => {
        const btn = document.getElementById('open-settings');
        const handler = () => setOpen(true);
        btn?.addEventListener('click', handler);
        return () => btn?.removeEventListener('click', handler);
    }, []);

    const fmtEvery = (n?: number) => {
        if (n === undefined) return '—';
        if (n === -1) return 'Nunca';
        return n === 1 ? 'Cada región' : `Cada ${n} regiones`;
    };

    return (
        <aside
            className={`fixed top-0 right-0 h-full w-80 bg-neutral-900 border-l border-neutral-800 shadow-xl transition-transform z-30 flex flex-col justify-between ${
                open ? 'translate-x-0' : 'translate-x-full'
            } text-neutral-100`}
        >
            <div>
                <div className='p-4 border-b border-neutral-800 flex items-center justify-between'>
                    <h2 className='font-semibold'>Ajustes</h2>
                    <button
                        className='btn-secondary'
                        onClick={() => setOpen(false)}
                    >
                        ✕
                    </button>
                </div>
                <div className='p-4 space-y-4'>
                    <div>
                        <label className='block text-sm mb-1'>
                            Dinero (+/−)
                        </label>
                        <div className='flex gap-2'>
                            <input
                                className='input w-full'
                                type='number'
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                            />
                            <button
                                className='btn'
                                onClick={() =>
                                    addMoney(parseInt(value, 10) || 0)
                                }
                            >
                                Aplicar
                            </button>
                        </div>
                    </div>

                    <div className='flex gap-2 flex-wrap'>
                        <button
                            className='btn w-full'
                            onClick={async () => {
                                await openConfigFolder();
                            }}
                        >
                            Abrir carpeta de configuración
                        </button>
                    </div>

                    <div className='text-sm opacity-80 space-y-1'>
                        <div>
                            Rerolls máximos:{' '}
                            <strong>{cfg?.rerollsPerRegion}</strong>
                        </div>
                        <div>
                            Recarga de rerolls:{' '}
                            <strong>
                                {fmtEvery(cfg?.rerollRechargeEveryRegions)}
                            </strong>
                        </div>
                        <div>
                            Regeneración de tienda:{' '}
                            <strong>
                                {fmtEvery(cfg?.shopRefreshEveryRegions)}
                            </strong>
                        </div>
                        <div>
                            Reset de rerolls al Actualizar:{' '}
                            <strong>
                                {cfg?.rerollResetOnRefresh ? 'Sí' : 'No'}
                            </strong>
                        </div>
                        <div>
                            Tamaño de tienda: <strong>{cfg?.shopSize}</strong>
                        </div>
                        <div>
                            Duplicar Pokémon:{' '}
                            <strong>
                                {cfg?.allowDuplicates ? 'Sí' : 'No'}
                            </strong>
                        </div>
                        <div>
                            Incluir pokémon comprados en tienda:{' '}
                            <strong>
                                {cfg?.includePurchasedInRerollPool
                                    ? 'Sí'
                                    : 'No'}
                            </strong>
                        </div>
                    </div>
                    <p className='text-xs opacity-60'>
                        Edita <code>config.json</code> y pulsa{' '}
                        <strong>Actualizar</strong>.
                    </p>
                </div>
            </div>

            <div className='p-4 gap-4 flex flex-col text-center'>
                <p className='text-xs opacity-60'>
                    Hecho por <b>Toskan4134</b>
                </p>
                <button
                    className='btn-danger w-full'
                    onClick={() => {
                        if (
                            window.confirm(
                                '¿Seguro que quieres borrar todos los datos? Esta acción no se puede deshacer.'
                            )
                        ) {
                            resetAll();
                        }
                    }}
                >
                    Borrar datos
                </button>
            </div>
        </aside>
    );
}
