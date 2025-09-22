import { useShopStore } from '../store/useShopStore';
import type { ShopPokemon } from '../types';
import SpriteImg from './SpriteImg';

// Hook para obtener el color asociado a un tier específico
function useTierColor(tier: string): string {
    const cfg = useShopStore((s) => s.cfg);
    const normalizedTier = String(tier || '').toUpperCase();
    const colorMap = cfg?.tierColors || {};
    return colorMap[normalizedTier] || cfg?.defaultTierColor || '#9ca3af';
}

export default function PokemonRow({
    p,
    index,
}: {
    p: ShopPokemon;
    index: number;
}) {
    // Acciones de la tienda
    const buyAt = useShopStore((s) => s.buyAt);
    const rerollAt = useShopStore((s) => s.rerollAt);
    const money = useShopStore((s) => s.money);
    const cfg = useShopStore((s) => s.cfg);
    const usedGlobal = useShopStore((s) => s.rerollsUsedGlobal);

    // Estado calculado
    const maxRerolls = cfg?.rerollsPerRegion ?? 0;
    const disabledReroll = (usedGlobal ?? 0) >= maxRerolls;
    const isPurchased = !!p.__purchased;
    const isExhausted = !!p.__exhausted;
    const borderColor = useTierColor(p.tier);

    // Slot vacío o sin pokémon disponibles
    if (p.id === -1) {
        return (
            <div
                className='card p-3 flex items-center gap-2 text-neutral-100'
                style={{ borderColor }}
            >
                <SpriteImg id={-1} size={40} />
                <div className='flex-1 italic opacity-80'>
                    No hay pokémon de este tier disponibles
                </div>
                <div className='opacity-80 w-24'>—</div>
                <button className='btn' disabled>
                    Comprar
                </button>
                <button className='btn-secondary' disabled title='Rerollear'>
                    ⟳
                </button>
            </div>
        );
    }

    return (
        <div
            className='card p-3 flex items-center gap-2 text-neutral-100'
            style={{ borderColor }}
        >
            {isPurchased || p == null ? (
                <SpriteImg id={-1} size={40} />
            ) : (
                <SpriteImg id={p.id} size={40} alt={p.nombre} />
            )}
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
                {isPurchased || isExhausted ? '—' : p.precio + '$'}
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
                title='Rerollear'
                disabled={disabledReroll}
            >
                ⟳
            </button>
        </div>
    );
}
