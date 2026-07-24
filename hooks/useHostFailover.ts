import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

type PlayerForFailover = {
  id: string;
  is_host: boolean;
  last_seen: string;
  created_at: string;
};

const DEFAULT_STALE_THRESHOLD_MS = 120000; // 2 minutes default — safe for mid-task screen locks
const CHECK_INTERVAL_MS = 10000;

export function useHostFailover(
  roomId: string | undefined,
  players: PlayerForFailover[],
  myPlayerId: string | undefined,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS
) {
  const playersRef = useRef<PlayerForFailover[]>(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    if (!roomId || !myPlayerId) return;

    const interval = setInterval(() => {
      const currentPlayers = playersRef.current;
      if (currentPlayers.length === 0) return;

      const currentHost = currentPlayers.find((p) => p.is_host);
      if (!currentHost) return;

      const hostStale = Date.now() - new Date(currentHost.last_seen).getTime() > staleThresholdMs;
      if (!hostStale) return;

      // Candidates: everyone but the stale host, who is themselves still active, earliest-joined first
      const activeCandidates = currentPlayers
        .filter(
          (p) =>
            p.id !== currentHost.id &&
            Date.now() - new Date(p.last_seen).getTime() < staleThresholdMs
        )
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (activeCandidates.length === 0) return;

      const nextHost = activeCandidates[0];

      // Only the presumptive next host performs the write — avoids every client racing to promote
      if (nextHost.id !== myPlayerId) return;

      promoteToHost(roomId, currentHost.id, nextHost.id);
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [roomId, myPlayerId, staleThresholdMs]);
}

async function promoteToHost(roomId: string, oldHostId: string, newHostId: string) {
  await supabase.from('players').update({ is_host: false }).eq('id', oldHostId);
  await supabase.from('players').update({ is_host: true }).eq('id', newHostId);
  await supabase.from('rooms').update({ host_id: newHostId }).eq('id', roomId);
}