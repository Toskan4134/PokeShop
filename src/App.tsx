import HistoryPanel from './components/HistoryPanel';
import PokemonRow from './components/PokemonRow';
import PurchasesPanel from './components/PurchasesPanel';
import SettingsPanel from './components/SettingsPanel';
import TopBar from './components/TopBar';
import { useShopStore } from './store/useShopStore';

export default function App() {
    const shop = useShopStore((s) => s.shop);
    return (
        <div className='min-h-screen bg-neutral-950'>
            <TopBar />
            <main className='container mx-auto max-w-screen-xl p-4 grid gap-4 lg:grid-cols-[1fr_420px]'>
                <div className='space-y-2'>
                    {shop.map((p, i) => (
                        <PokemonRow key={p?.id + '-' + i} p={p} index={i} />
                    ))}
                </div>
                <div className='gap-4 flex lg:flex-col flex-col-reverse'>
                    <HistoryPanel />
                    <PurchasesPanel />
                </div>
            </main>
            <SettingsPanel />
        </div>
    );
}
