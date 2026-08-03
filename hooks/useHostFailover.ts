import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

type PlayerForFailover = {
  id: string;
  is_host: boolean;
  is_alive?: boolean;
  last_seen: string;
  created_at: string;
};

const DEFAULT_STALE_THRESHOLD_MS = 120000; // 2 minutes
const CHECK_INTERVAL_MS = 10000;

export function useHostFailover(
  roomId: string | undefined,
  players: PlayerForFailover[],
  myPlayerId: string | undefined,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
  eliminateStale: boolean = false
) {
  const playersRef = useRef<PlayerForFailover[]>(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    if (!roomId || !myPlayerId) return;

    const interval = setInterval(() => {
      (async () => {
        const currentPlayers = playersRef.current;
        if (currentPlayers.length === 0) return;

        const now = Date.now();

        // ── Host failover ──────────────────────────────────────────────────
        const currentHost = currentPlayers.find((p) => p.is_host);
        if (currentHost) {
          const hostStale = now - new Date(currentHost.last_seen).getTime() > staleThresholdMs;

          if (hostStale) {
            const activeCandidates = currentPlayers
              .filter(
                (p) =>
                  p.id !== currentHost.id &&
                  now - new Date(p.last_seen).getTime() < staleThresholdMs
              )
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

            if (activeCandidates.length === 0) {
              await supabase.from('rooms').update({ status: 'ended' }).eq('id', roomId);
              return;
            }

            const nextHost = activeCandidates[0];
            if (nextHost.id === myPlayerId) {
              await promoteToHost(roomId, currentHost.id, nextHost.id);
            }
          }
        }

        // ── Stale player elimination (game screen only) ────────────────────
        if (!eliminateStale) return;

        // Earliest-joined active player acts as the sole executor — avoids races
        const activePlayers = currentPlayers
          .filter((p) => now - new Date(p.last_seen).getTime() < staleThresholdMs)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        if (activePlayers.length === 0) return;
        if (activePlayers[0].id !== myPlayerId) return;

        const staleLivingPlayers = currentPlayers.filter(
          (p) =>
            p.is_alive === true &&
            p.id !== myPlayerId &&
            now - new Date(p.last_seen).getTime() > staleThresholdMs
        );

        for (const stalePlayer of staleLivingPlayers) {
          await supabase
            .from('players')
            .update({ is_alive: false })
            .eq('id', stalePlayer.id);
        }
      })();
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [roomId, myPlayerId, staleThresholdMs, eliminateStale]);
}

async function promoteToHost(roomId: string, oldHostId: string, newHostId: string) {
  await supabase.from('players').update({ is_host: false }).eq('id', oldHostId);
  await supabase.from('players').update({ is_host: true }).eq('id', newHostId);
  await supabase.from('rooms').update({ host_id: newHostId }).eq('id', roomId);
}