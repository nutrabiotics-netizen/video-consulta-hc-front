/**
 * WebSocket para transcripción en vivo y propuestas de IA.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const getWsUrl = () => {
  // Vercel no soporta WebSocket: usar VITE_WS_URL (ej. backend en Railway/Render) o mismo origen si hay servidor WS
  const base = (import.meta as any).env?.VITE_WS_URL;
  if (base) {
    const url = base.startsWith('http') ? base.replace(/^http/, 'ws') : base.replace(/^https/, 'wss');
    return url.endsWith('/ws') ? url : `${url.replace(/\/$/, '')}/ws`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = (import.meta as any).env?.DEV ? 'localhost:5173' : window.location.host;
  return `${proto}//${host}/ws`;
};

export interface TranscriptionPayload {
  text: string;
  isPartial: boolean;
  participant?: string;
}

export interface ProposalPayload {
  propuestas: Array< { seccion: string; contenido: string }>;
}

export interface SectionActionPayload {
  seccion: string;
  accion: 'aceptar' | 'rechazar' | 'editar';
  contenido?: string;
}

export function useWs(roomId: string, role?: string, patientId?: string) {
  const [transcription, setTranscription] = useState<TranscriptionPayload[]>([]);
  const [proposals, setProposals] = useState<ProposalPayload['propuestas']>([]);
  const [agentSummary, setAgentSummary] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'listening' | 'connected'>('idle');
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef(roomId);

  roomRef.current = roomId;

  const send = useCallback((type: string, payload?: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
  }, []);

  const sendTranscription = useCallback(
    (text: string, isPartial: boolean, participant?: string) => {
      setTranscription((prev) => [...prev.slice(-99), { text, isPartial, participant }]);
      send('transcription', { text, isPartial, participant });
    },
    [send]
  );

  const processWithAgent = useCallback(
    (
      transcription: string,
      isPartial: boolean,
      currentSections?: Record<string, string>,
      patientIdOverride?: string,
      activeSection?: string
    ) => {
      setAgentStatus('listening');
      send('process_with_agent', {
        patientId: patientIdOverride ?? patientId ?? '1',
        transcription,
        isPartial,
        currentSections,
        activeSection,
      });
    },
    [send, patientId]
  );

  const sendSectionAction = useCallback(
    (seccion: string, accion: 'aceptar' | 'rechazar' | 'editar', contenido?: string) => {
      send('section_action', { seccion, accion, contenido });
    },
    [send]
  );

  useEffect(() => {
    if (!roomId) return;
    const url = `${getWsUrl()}?roomId=${encodeURIComponent(roomId)}&role=${role || ''}&patientId=${patientId || ''}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcription') {
          setTranscription((prev) => {
            const next = [...prev];
            const p = msg.payload;
            if (p?.text) next.push({ text: p.text, isPartial: !!p.isPartial, participant: p.participant });
            return next.slice(-100);
          });
        } else if (msg.type === 'proposal') {
          const p = msg.payload as { resumen?: string; propuestas?: ProposalPayload['propuestas'] };
          if (typeof p?.resumen === 'string') setAgentSummary(p.resumen);
          setProposals(p?.propuestas || []);
          setAgentStatus('connected');
        } else if (msg.type === 'proposal_error') {
          setAgentStatus('idle');
        }
      } catch (_) {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [roomId, role, patientId]);

  return {
    connected,
    transcription,
    proposals,
    setProposals,
    agentSummary,
    agentStatus,
    send,
    sendTranscription,
    processWithAgent,
    sendSectionAction,
  };
}
