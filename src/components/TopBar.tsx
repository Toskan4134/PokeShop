import { useEffect } from 'react';
import { useShopStore } from '../store/useShopStore';
import ProfileManager from './ProfileManager';

export default function TopBar() {
    // Selectores del estado de la tienda
    const bootstrap = useShopStore((s) => s.bootstrap);
    const regions = useShopStore((s) => s.regions);
    const activeIdx = useShopStore((s) => s.currentRegionIndex);
    const selectedIdx = useShopStore((s) => s.selectedRegionIndex);
    const money = useShopStore((s) => s.money);
    const cfg = useShopStore((s) => s.cfg);
    const usedGlobal = useShopStore((s) => s.rerollsUsedGlobal);
    const undoStack = useShopStore((s) => s.undoStack);

    // Acciones de la tienda
    const selectRegionIndex = useShopStore((s) => s.selectRegionIndex);
    const nextSel = useShopStore((s) => s.nextSelectedRegion);
    const prevSel = useShopStore((s) => s.prevSelectedRegion);
    const applySelectedRegionAndRefresh = useShopStore((s) => s.applySelectedRegionAndRefresh);
    const refresh = useShopStore((s) => s.refresh);
    const undo = useShopStore((s) => s.undoLast);

    // Inicializar tienda si no está configurada
    useEffect(() => {
        if (!cfg) {
            bootstrap();
        }
    }, [bootstrap, cfg]);

    // Valores calculados
    const activeRegion = regions[activeIdx] ?? '';
    const remainingRerolls = Math.max(0, (cfg?.rerollsPerRegion ?? 0) - (usedGlobal ?? 0));
    const hasRegionChange = activeIdx !== selectedIdx;

    // Manejadores de eventos
    const handleApplyOrRefresh = () => {
        if (hasRegionChange) {
            applySelectedRegionAndRefresh();
        } else {
            refresh();
        }
    };

    const handleRegionSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        selectRegionIndex(parseInt(e.target.value, 10));
    };

    const buttonLabel = hasRegionChange ? 'Aplicar región' : 'Actualizar';

    return (
        <header className='px-4 py-3 bg-neutral-900/80 backdrop-blur border-b border-neutral-800 flex items-center gap-3 text-neutral-100'>
            {/* Botón deshacer */}
            <button
                className='btn-secondary'
                onClick={undo}
                disabled={undoStack.length === 0}
                title='Deshacer última acción'
            >
                ↶
            </button>

            {/* Selector de región */}
            <select
                className='input w-auto'
                value={selectedIdx}
                onChange={handleRegionSelect}
            >
                {regions.map((region, index) => (
                    <option key={region} value={index}>
                        {region}
                    </option>
                ))}
            </select>

            {/* Navegación de regiones */}
            <button
                className='btn'
                onClick={prevSel}
                disabled={selectedIdx === 0}
                title='Región anterior'
            >
                ⟨
            </button>

            <button
                className='btn'
                onClick={nextSel}
                disabled={selectedIdx === regions.length - 1}
                title='Región siguiente'
            >
                ⟩
            </button>

            {/* Botón aplicar/actualizar */}
            <button className='btn' onClick={handleApplyOrRefresh}>
                {buttonLabel}
            </button>

            {/* Panel de información */}
            <div className='ml-auto flex items-center gap-6'>
                <span>
                    Región activa: <strong>{activeRegion}</strong>
                </span>
                <span>
                    Rerolls: <strong>{remainingRerolls}</strong>
                </span>
                <span>
                    Dinero: <strong>{money}</strong>
                </span>
                <ProfileManager />
                <button
                    id='open-settings'
                    className='btn-secondary'
                    title='Configuración'
                >
                    ⚙
                </button>
            </div>
        </header>
    );
}
