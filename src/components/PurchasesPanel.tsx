import { useShopStore } from '../store/useShopStore';
import SpriteImg from './SpriteImg';

export default function PurchasesPanel() {
    const purchases = useShopStore((s) => s.purchases);
    return (
        <div className='card p-3 max-h-72 text-neutral-100 flex flex-col gap-2'>
            <h2 className='font-semibold mb-2'>Compras</h2>
            <div className='overflow-auto customScroll h-full'>
                {purchases.length === 0 ? (
                    <p className='text-sm opacity-70'>
                        Aún no has comprado ningún Pokémon.
                    </p>
                ) : (
                    <ul className='space-y-1 text-sm'>
                        {purchases.map((p) => (
                            <li
                                key={p.id}
                                className='border-b border-neutral-700 pb-1 flex'
                            >
                                <div className='flex items-center gap-2 w-full'>
                                    <SpriteImg id={p.pokemonId} size={20} />
                                    <div className='flex items-center gap-2 min-w-0 justify-between w-full'>
                                        <div className='truncate'>
                                            <span className='opacity-70'>
                                                [
                                                {new Date(
                                                    p.ts
                                                ).toLocaleDateString()}
                                                ]
                                            </span>{' '}
                                            {p.nombre} ({p.tier})
                                        </div>
                                        <div className='opacity-80 whitespace-nowrap flex gap-2'>
                                            <span>{p.precio}$</span>
                                            {p.region}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
