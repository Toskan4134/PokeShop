import { useShopStore } from '../store/useShopStore';
import type { ShopPokemon } from '../types';

function useTierColor(tier: string): string {
    const cfg = useShopStore((s) => s.cfg);
    const t = String(tier || '').toUpperCase();
    const map = cfg?.tierColors || {};
    return map[t] || cfg?.defaultTierColor || '#9ca3af';
}

export default function PokemonRow({
    p,
    index,
}: {
    p: ShopPokemon;
    index: number;
}) {
    const buyAt = useShopStore((s) => s.buyAt);
    const rerollAt = useShopStore((s) => s.rerollAt);
    const money = useShopStore((s) => s.money);
    const cfg = useShopStore((s) => s.cfg);
    const usedGlobal = useShopStore((s) => s.rerollsUsedGlobal);
    const max = cfg?.rerollsPerRegion ?? 0; // usamos esta clave como “máximo rerolls globales”
    const disabledReroll = (usedGlobal ?? 0) >= max;
    const isPurchased = !!p.__purchased;
    const isExhausted = !!p.__exhausted;
    const borderColor = useTierColor(p.tier);

    if (p.id === -1) {
        // Pokémon no disponible (comprado o no quedan más)
        return (
            <div
                className='card p-3 flex items-center gap-2 text-neutral-100 border-2'
                style={{ borderColor }}
            >
                <div className='flex-1 italic opacity-80'>
                    No hay pokémon de este tier disponibles
                </div>
                <div className='opacity-80 w-24'>—</div>
                <button className='btn' disabled>
                    Comprar
                </button>
                <button className='btn-secondary' disabled title='Reroll'>
                    ⟳
                </button>
            </div>
        );
    }

    return (
        <div
            className='card p-3 flex items-center gap-2 text-neutral-100 border-2'
            style={{ borderColor }}
        >
            <div className='flex-1 truncate'>
                {isExhausted ? (
                    <span className='italic opacity-80'>
                        No hay pokémon de este tier disponibles
                    </span>
                ) : isPurchased || p == null ? (
                    <span className='italic opacity-80'>Comprado</span>
                ) : (
                    <>
                        {p.nombre}{' '}
                        <span className='opacity-70'>(Tier {p.tier})</span>
                    </>
                )}
            </div>
            <div className='opacity-80 w-24'>
                {isPurchased || isExhausted ? '—' : p.precio}
            </div>
            <button
                className='btn'
                onClick={() => buyAt(index)}
                disabled={isPurchased || isExhausted || money < p.precio}
            >
                Comprar
            </button>
            <button
                className='btn-secondary'
                onClick={() => rerollAt(index)}
                title='Reroll'
                disabled={disabledReroll}
            >
                ⟳
            </button>
        </div>
    );
}
