import { useEffect } from 'react';
import { useShopStore } from '../store/useShopStore';

export default function TopBar() {
    const bootstrap = useShopStore((s) => s.bootstrap);
    const regions = useShopStore((s) => s.regions);
    const activeIdx = useShopStore((s) => s.currentRegionIndex);
    const selectedIdx = useShopStore((s) => s.selectedRegionIndex);
    const selectRegionIndex = useShopStore((s) => s.selectRegionIndex);
    const nextSel = useShopStore((s) => s.nextSelectedRegion);
    const prevSel = useShopStore((s) => s.prevSelectedRegion);
    const applySelectedRegionAndRefresh = useShopStore(
        (s) => s.applySelectedRegionAndRefresh
    );
    const refresh = useShopStore((s) => s.refresh);
    const undo = useShopStore((s) => s.undoLast);
    const undoStack = useShopStore((s) => s.undoStack);
    const money = useShopStore((s) => s.money);
    const cfg = useShopStore((s) => s.cfg);
    const usedGlobal = useShopStore((s) => s.rerollsUsedGlobal);

    useEffect(() => {
        bootstrap();
    }, [bootstrap]);

    const activeRegion = regions[activeIdx] ?? '';
    const remaining = Math.max(
        0,
        (cfg?.rerollsPerRegion ?? 0) - (usedGlobal ?? 0)
    );

    const apply = () => {
        if (activeIdx !== selectedIdx) applySelectedRegionAndRefresh();
        else refresh();
    };
    const btnLabel =
        activeIdx !== selectedIdx ? 'Aplicar región' : 'Actualizar';

    return (
        <header className='px-4 py-3 bg-neutral-900/80 backdrop-blur border-b border-neutral-800 flex items-center gap-3 text-neutral-100'>
            <button
                className='btn-secondary'
                onClick={undo}
                disabled={undoStack.length === 0}
                title='Deshacer última acción'
            >
                ↶
            </button>
            <select
                className='input w-auto'
                value={selectedIdx}
                onChange={(e) =>
                    selectRegionIndex(parseInt(e.target.value, 10))
                }
            >
                {regions.map((r, i) => (
                    <option key={r} value={i}>
                        {r}
                    </option>
                ))}
            </select>
            <button
                className='btn'
                onClick={prevSel}
                disabled={selectedIdx === 0}
            >
                ⟨
            </button>
            <button
                className='btn'
                onClick={nextSel}
                disabled={selectedIdx === regions.length - 1}
            >
                ⟩
            </button>
            <button className='btn' onClick={apply}>
                {btnLabel}
            </button>
            <div className='ml-auto flex items-center gap-6'>
                <span>
                    Región activa: <strong>{activeRegion}</strong>
                </span>
                <span>
                    Rerolls: <strong>{remaining}</strong>
                </span>
                <span>
                    Dinero: <strong>{money}</strong>
                </span>
                <button
                    id='open-settings'
                    className='btn-secondary'
                    title='Ajustes'
                >
                    ⚙
                </button>
            </div>
        </header>
    );
}
