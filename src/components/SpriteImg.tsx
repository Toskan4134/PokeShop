import { useEffect, useState } from 'react';
import { resolveSpriteUrl } from '../lib/sprites';

type Props = {
    id: number;
    size?: number; // px
    alt?: string;
    className?: string;
    rounded?: boolean;
};

export default function SpriteImg({
    id,
    size = 48,
    alt = '',
    className = '',
    rounded = true,
}: Props) {
    const [src, setSrc] = useState<string>('/sprites-default/missing.png');

    useEffect(() => {
        let alive = true;
        (async () => {
            const url = await resolveSpriteUrl(id);
            if (alive) setSrc(url);
        })();
        return () => {
            alive = false;
        };
    }, [id]);

    return (
        <img
            src={src}
            alt={alt}
            width={size}
            height={size}
            className={`shrink-0 object-contain ${
                rounded ? 'rounded-xl' : ''
            } ${className}`}
            onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                if (!el.dataset._fallback) {
                    el.dataset._fallback = '1';
                    el.src = '/sprites-default/missing.png';
                }
            }}
            style={{ width: size, height: size }}
        />
    );
}
