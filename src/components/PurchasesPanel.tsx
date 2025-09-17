import { useShopStore } from '../store/useShopStore';

export default function PurchasesPanel() {
    const purchases = useShopStore((s) => s.purchases);
    return (
        <div className='card p-3 max-h-64 overflow-auto text-neutral-100'>
            <h2 className='font-semibold mb-2'>Compras</h2>
            {purchases.length === 0 ? (
                <p className='text-sm opacity-70'>
                    Aún no has comprado ningún Pokémon.
                </p>
            ) : (
                <ul className='space-y-1 text-sm'>
                    {purchases.map((p) => (
                        <li
                            key={p.id}
                            className='border-b border-neutral-700 pb-1 flex items-center justify-between gap-2'
                        >
                            <div className='truncate'>
                                <span className='opacity-70'>
                                    [{new Date(p.ts).toLocaleDateString()}]
                                </span>{' '}
                                {p.nombre} ({p.tier})
                            </div>
                            <div className='opacity-80 whitespace-nowrap flex gap-2'>
                                <span>{p.precio}$</span>
                                {p.region}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
