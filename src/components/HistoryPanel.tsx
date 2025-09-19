import { useShopStore } from '../store/useShopStore';

export default function HistoryPanel() {
    const history = useShopStore((s) => s.history);
    return (
        <div className='card p-3 max-h-72 overflow-auto text-neutral-100'>
            <h2 className='font-semibold mb-2'>Historial</h2>
            <ul className='space-y-1 text-sm'>
                {history.map((h) => (
                    <li key={h.id} className='border-b border-neutral-700 pb-1'>
                        <span className='opacity-70'>
                            [{new Date(h.ts).toLocaleString()}]
                        </span>{' '}
                        {h.message}
                    </li>
                ))}
            </ul>
        </div>
    );
}
