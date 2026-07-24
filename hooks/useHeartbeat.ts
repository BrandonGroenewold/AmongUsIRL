import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { supabase } from '../lib/supabase';

export function useHeartbeat(playerId: string | undefined) {
  useEffect(() => {
    if (!playerId) return;

    const sendHeartbeat = async () => {
      await supabase
        .from('players')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', playerId);
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 8000);

   // Fire immediately when the app comes back from background/locked (native)
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        sendHeartbeat();
      }
    });

    // Fire immediately when a browser tab regains focus (web) — Chrome throttles
    // setInterval heavily in background tabs, so heartbeats stall out until this fires
    let visibilityHandler: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          sendHeartbeat();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }

    return () => {
      clearInterval(interval);
      appStateSub.remove();
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    };
  }, [playerId]);
}