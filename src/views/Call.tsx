import { useEffect, useState, useRef, useCallback } from 'react';
import { createAttendee, apiBase } from '../api/client';
import type { ChimeMeetingInfo, ChimeAttendeeInfo } from '../api/client';
import { useChime } from '../hooks/useChime';
import { useLiveTranscription } from '../hooks/useLiveTranscription';
import { useWs } from '../hooks/useWs';
import {
  HISTORIA_SECCIONES,
  SECCION_LABELS,
  type SeccionHistoria,
  type SeccionState,
} from '../types';

/** ID del paciente por defecto cuando se conecta como "paciente"; se envía a Bedrock. */
const DEFAULT_PATIENT_ID = '695bd5e7e2a3a01d24f01186';

interface CallProps {
  meetingId: string;
  externalMeetingId: string;
  role: 'medico' | 'paciente';
  patientId: string;
  onLeave: () => void;
}

export default function Call({
  meetingId,
  role,
  patientId,
  onLeave,
}: CallProps) {
  const effectivePatientId = role === 'paciente' ? DEFAULT_PATIENT_ID : patientId;

  const [meetingInfo, setMeetingInfo] = useState<ChimeMeetingInfo | null>(null);
  const [attendeeInfo, setAttendeeInfo] = useState<ChimeAttendeeInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showMeetingId, setShowMeetingId] = useState(false);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);

  const chime = useChime(meetingInfo, attendeeInfo, {
    selectedAudioId,
    selectedVideoId,
    selectedOutputId,
  });
  const ws = useWs(meetingId, role, effectivePatientId);
  const liveTranscription = useLiveTranscription(ws.send, role);

  const [secciones, setSecciones] = useState<Record<SeccionHistoria, SeccionState>>(() => {
    const o = {} as Record<SeccionHistoria, SeccionState>;
    HISTORIA_SECCIONES.forEach((s) => {
      o[s] = { contenido: '', estado: 'vacia' };
    });
    return o;
  });
  /** Índice de la sección que se está llenando; solo esta recibe propuestas de IA. */
  const [seccionActivaIndex, setSeccionActivaIndex] = useState(0);

  const lastTranscriptionRef = useRef('');
  const lastSentToAgentRef = useRef('');
  const agentListenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seccionesRef = useRef(secciones);
  const seccionActivaIndexRef = useRef(seccionActivaIndex);
  seccionesRef.current = secciones;
  seccionActivaIndexRef.current = seccionActivaIndex;

  // Obtener meeting info (si no la tenemos, ej. al unirse)
  useEffect(() => {
    if (meetingInfo) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/chime/meeting/${meetingId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setMeetingInfo(data);
        } else {
          if (!cancelled) setLoadError('Reunión no encontrada. Crea una nueva o verifica el ID.');
        }
      } catch {
        if (!cancelled) setLoadError('Error al cargar la reunión');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, meetingInfo]);

  // Crear attendee cuando tengamos meeting
  useEffect(() => {
    if (!meetingInfo || attendeeInfo) return;
    const externalUserId = role === 'medico' ? `medico-${patientId}` : `paciente-${effectivePatientId}`;
    createAttendee(meetingId, externalUserId)
      .then(setAttendeeInfo)
      .catch((e) => setLoadError(e.message));
  }, [meetingInfo, meetingId, role, patientId, effectivePatientId, attendeeInfo]);

  // Paciente: pedir permisos de cámara/micrófono antes de Chime para que la cámara enganche
  useEffect(() => {
    if (role !== 'paciente' || !meetingInfo) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((s) => {
        stream = s;
        setTimeout(() => stream?.getTracks().forEach((t) => t.stop()), 800);
      })
      .catch((e) => console.warn('Permisos paciente:', e));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [role, meetingInfo]);

  // Iniciar sesión Chime cuando tengamos ambos (paciente: breve delay para que permisos vayan primero)
  useEffect(() => {
    if (!meetingInfo || !attendeeInfo || chime.session) return;
    if (role === 'paciente') {
      const t = setTimeout(() => chime.startSession(), 600);
      return () => clearTimeout(t);
    }
    chime.startSession();
  }, [meetingInfo, attendeeInfo, chime.session, role, chime.startSession]);

  // Enviar transcripción al backend (mock: desde texto; en producción sería desde audio/Transcribe)
  const pushTranscription = useCallback(
    (text: string, isPartial: boolean) => {
      if (!text.trim()) return;
      ws.sendTranscription(text, isPartial, role);
      lastTranscriptionRef.current = text;
      if (!isPartial && role === 'medico') {
        const current: Record<string, string> = {};
        HISTORIA_SECCIONES.forEach((s) => {
          const st = secciones[s];
          if (st.contenido) current[s] = st.contenido;
        });
        const seccionActiva = HISTORIA_SECCIONES[seccionActivaIndex];
        ws.processWithAgent(text, false, current, DEFAULT_PATIENT_ID, seccionActiva);
      }
    },
    [ws, role, secciones, seccionActivaIndex]
  );

  // Agente escuchando: enviar transcripción al agente (incl. parcial) tras debounce para que genere resumen y propuestas
  useEffect(() => {
    if (role !== 'medico' || ws.transcription.length === 0) return;
    // Incluir también segmentos parciales para que el agente reciba contenido mientras hablan
    const fullTranscript = ws.transcription
      .map((t) => (t.participant ? `[${t.participant}]: ` : '') + t.text)
      .join('\n');
    if (!fullTranscript.trim()) return;
    const lastSegment = ws.transcription[ws.transcription.length - 1];
    const isPartial = lastSegment?.isPartial ?? false;
    if (agentListenTimeoutRef.current) clearTimeout(agentListenTimeoutRef.current);
    agentListenTimeoutRef.current = setTimeout(() => {
      agentListenTimeoutRef.current = null;
      if (fullTranscript === lastSentToAgentRef.current) return;
      lastSentToAgentRef.current = fullTranscript;
      const current: Record<string, string> = {};
      HISTORIA_SECCIONES.forEach((s) => {
        const st = seccionesRef.current[s];
        if (st?.contenido) current[s] = st.contenido;
      });
      const seccionActiva = HISTORIA_SECCIONES[seccionActivaIndexRef.current];
      ws.processWithAgent(fullTranscript, isPartial, current, DEFAULT_PATIENT_ID, seccionActiva);
    }, 2000);
    return () => {
      if (agentListenTimeoutRef.current) clearTimeout(agentListenTimeoutRef.current);
    };
  }, [role, ws.transcription, ws, seccionActivaIndex]);

  // Aplicar propuestas de IA solo a la sección activa (llenado por partes)
  useEffect(() => {
    if (ws.proposals.length === 0) return;
    const seccionActiva = HISTORIA_SECCIONES[seccionActivaIndex];
    setSecciones((prev) => {
      const next = { ...prev };
      ws.proposals.forEach((p: { seccion: string; contenido: string }) => {
        if ((p.seccion as SeccionHistoria) !== seccionActiva) return;
        if (!HISTORIA_SECCIONES.includes(p.seccion as SeccionHistoria)) return;
        next[p.seccion as SeccionHistoria] = {
          contenido: prev[p.seccion as SeccionHistoria]?.contenido || '',
          estado: 'propuesta',
          propuestaPendiente: p.contenido,
        };
      });
      return next;
    });
    ws.setProposals([]);
  }, [ws.proposals, seccionActivaIndex]);

  const acceptSection = useCallback((sec: SeccionHistoria) => {
    setSecciones((prev) => {
      const s = prev[sec];
      const next = { ...prev };
      next[sec] = {
        contenido: s?.propuestaPendiente || s?.contenido || '',
        estado: 'aceptada',
      };
      ws.sendSectionAction(sec, 'aceptar', next[sec].contenido);
      return next;
    });
  }, [ws]);

  const rejectSection = useCallback((sec: SeccionHistoria) => {
    setSecciones((prev) => ({
      ...prev,
      [sec]: { ...prev[sec], estado: 'rechazada', propuestaPendiente: undefined },
    }));
    ws.sendSectionAction(sec, 'rechazar');
  }, [ws]);

  const editSection = useCallback((sec: SeccionHistoria, contenido: string) => {
    setSecciones((prev) => ({
      ...prev,
      [sec]: { contenido, estado: 'editada', propuestaPendiente: undefined },
    }));
    ws.sendSectionAction(sec, 'editar', contenido);
  }, [ws]);

  if (loadError) {
    return (
      <div style={s.container}>
        <p style={s.error}>{loadError}</p>
        <button onClick={onLeave} style={s.btn}>Volver</button>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <header style={s.header}>
        <span>Video Consulta — {role === 'medico' ? 'Médico' : 'Paciente'}</span>
        <div>
          <button type="button" onClick={() => setShowMeetingId(!showMeetingId)} style={s.smallBtn}>
            {showMeetingId ? 'Ocultar ID' : 'Ver Meeting ID'}
          </button>
          {showMeetingId && (
            <code style={s.meetingId}>{meetingId}</code>
          )}
          <button
            onClick={() => {
              liveTranscription.stop();
              chime.leave();
              onLeave();
            }}
            style={s.btn}
          >
            Salir
          </button>
        </div>
      </header>

      <div style={s.main}>
        <div style={s.videoPanel}>
          <div style={s.videoBox}>
            <video ref={chime.localVideoRef} autoPlay muted playsInline style={s.video} />
            <span style={s.videoLabel}>Tú</span>
          </div>
          <div style={s.videoBox}>
            <video ref={chime.remoteVideoRef} autoPlay playsInline style={s.video} />
            <span style={s.videoLabel}>Remoto</span>
          </div>
          <div style={s.controls}>
            <button onClick={chime.toggleAudio} style={s.controlBtn}>
              {chime.localAudioEnabled ? '🔊 Silenciar' : '🔇 Activar audio'}
            </button>
            <button onClick={chime.toggleVideo} style={s.controlBtn}>
              {chime.localVideoEnabled ? '📹 Apagar cámara' : '📷 Encender cámara'}
            </button>
          </div>
          <div style={s.deviceControls}>
            <label style={s.deviceLabel}>Micrófono</label>
            <select
              style={s.deviceSelect}
              value={selectedAudioId ?? (chime.audioInputDevices[0]?.deviceId ?? '')}
              onChange={(e) => {
                const id = e.target.value || null;
                setSelectedAudioId(id);
                if (id) chime.changeAudioInput(id);
              }}
              disabled={chime.audioInputDevices.length === 0}
            >
              {chime.audioInputDevices.length === 0 && (
                <option value="">Cargando…</option>
              )}
              {chime.audioInputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Micrófono ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            <label style={s.deviceLabel}>Cámara</label>
            <select
              style={s.deviceSelect}
              value={selectedVideoId ?? (chime.videoInputDevices[0]?.deviceId ?? '')}
              onChange={(e) => {
                const id = e.target.value || null;
                setSelectedVideoId(id);
                if (id) chime.changeVideoInput(id);
              }}
              disabled={chime.videoInputDevices.length === 0}
            >
              {chime.videoInputDevices.length === 0 && (
                <option value="">Cargando…</option>
              )}
              {chime.videoInputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Cámara ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            <label style={s.deviceLabel}>Altavoces</label>
            <select
              style={s.deviceSelect}
              value={selectedOutputId ?? (chime.audioOutputDevices[0]?.deviceId ?? '')}
              onChange={(e) => {
                const id = e.target.value || null;
                setSelectedOutputId(id);
                chime.changeAudioOutput(id);
              }}
              disabled={chime.audioOutputDevices.length === 0}
            >
              {chime.audioOutputDevices.length === 0 && (
                <option value="">Cargando…</option>
              )}
              {chime.audioOutputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Salida ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={s.rightPanel}>
          {role === 'medico' && (
            <section style={s.section}>
              <h3 style={s.sectionTitle}>
                Resumen del paciente (ID: {DEFAULT_PATIENT_ID})
                <span style={ws.agentStatus === 'connected' ? s.agentOk : ws.agentStatus === 'listening' ? s.agentListening : s.agentIdle}>
                  {ws.agentStatus === 'connected' ? ' ● Conectado' : ws.agentStatus === 'listening' ? ' ◐ Escuchando…' : ' ○ En espera'}
                </span>
              </h3>
              <div style={s.summaryBox}>
                {ws.agentSummary ? (
                  <p style={s.summaryText}>{ws.agentSummary}</p>
                ) : (
                  <p style={s.hint}>El agente irá generando un resumen según la conversación.</p>
                )}
              </div>
            </section>
          )}
          <section style={s.section}>
            <h3 style={s.sectionTitle}>
              Transcripción en vivo
              <span style={ws.connected ? s.wsOk : s.wsOff}>
                {ws.connected ? ' ● Conectado' : ' ○ Desconectado'}
              </span>
              {liveTranscription.isActive && (
                <span style={s.wsOk}> · Micrófono activo</span>
              )}
            </h3>
            <div style={s.transcriptionBox}>
              {ws.transcription.length === 0 && (
                <p style={s.hint}>
                  La transcripción aparecerá aquí. Activa el micrófono o usa el cuadro de abajo para simular.
                </p>
              )}
              {ws.transcription.map((t: { text: string; isPartial: boolean; participant?: string }, i: number) => (
                <div key={i} style={s.transcriptionLine}>
                  {t.participant && <strong>{t.participant}: </strong>}
                  {t.text} {t.isPartial && <em>(parcial)</em>}
                </div>
              ))}
            </div>
            <div style={s.inputRow}>
              <button
                type="button"
                onClick={liveTranscription.isActive ? liveTranscription.stop : liveTranscription.start}
                style={liveTranscription.isActive ? s.rejectBtn : s.controlBtn}
              >
                {liveTranscription.isActive ? 'Desactivar transcripción por micrófono' : 'Activar transcripción por micrófono'}
              </button>
            </div>
            {role === 'medico' && (
              <TranscriptionInput onSend={pushTranscription} />
            )}
          </section>

          <section style={s.section}>
            <h3 style={s.sectionTitle}>
              Historia clínica (propuestas IA)
              <span style={s.sectionCount}>
                {' '}
                — Sección {seccionActivaIndex + 1} de {HISTORIA_SECCIONES.length}
              </span>
            </h3>
            {role === 'medico' && (
              <div style={s.inputRow}>
                <button
                  type="button"
                  onClick={() => setSeccionActivaIndex((i) => Math.min(i + 1, HISTORIA_SECCIONES.length - 1))}
                  disabled={seccionActivaIndex >= HISTORIA_SECCIONES.length - 1}
                  style={s.controlBtn}
                >
                  Pasar a siguiente sección
                </button>
                {seccionActivaIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setSeccionActivaIndex((i) => Math.max(0, i - 1))}
                    style={s.smallBtn}
                  >
                    Sección anterior
                  </button>
                )}
              </div>
            )}
            <div style={s.historiaBox}>
              {HISTORIA_SECCIONES.map((sec, idx) => (
                <SeccionBlock
                  key={sec}
                  seccion={sec}
                  state={secciones[sec]}
                  isActive={idx === seccionActivaIndex}
                  onAccept={() => acceptSection(sec)}
                  onReject={() => rejectSection(sec)}
                  onEdit={(text) => editSection(sec, text)}
                  readonly={role !== 'medico'}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TranscriptionInput({ onSend }: { onSend: (text: string, isPartial: boolean) => void }) {
  const [text, setText] = useState('');
  return (
    <div style={s.inputRow}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Simular transcripción (escribe y Enviar)"
        style={s.textInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (text.trim()) {
              onSend(text.trim(), false);
              setText('');
            }
          }
        }}
      />
      <button
        onClick={() => {
          if (text.trim()) {
            onSend(text.trim(), false);
            setText('');
          }
        }}
        style={s.sendBtn}
      >
        Enviar
      </button>
    </div>
  );
}

function SeccionBlock({
  seccion,
  state,
  isActive,
  onAccept,
  onReject,
  onEdit,
  readonly,
}: {
  seccion: SeccionHistoria;
  state: SeccionState;
  isActive?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (text: string) => void;
  readonly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(state.contenido || state.propuestaPendiente || '');

  const content = state.contenido || state.propuestaPendiente || '';
  const hasProposal = state.estado === 'propuesta' && state.propuestaPendiente;

  return (
    <div style={isActive ? { ...s.seccionCard, ...s.seccionCardActive } : s.seccionCard}>
      <h4 style={s.seccionName}>
        {SECCION_LABELS[seccion]}
        {isActive && <span style={s.seccionActiveLabel}> — Sección activa (recibe propuestas IA)</span>}
      </h4>
      {editing ? (
        <div>
          <textarea
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            style={s.textarea}
            rows={3}
          />
          <button onClick={() => { onEdit(editVal); setEditing(false); }} style={s.smallBtn}>Guardar</button>
          <button onClick={() => setEditing(false)} style={s.smallBtn}>Cancelar</button>
        </div>
      ) : (
        <>
          <p style={s.seccionContent}>{content || '(vacío)'}</p>
          {!readonly && hasProposal && (
            <div style={s.actions}>
              <button onClick={onAccept} style={s.acceptBtn}>Aceptar</button>
              <button onClick={onReject} style={s.rejectBtn}>Rechazar</button>
            </div>
          )}
          {!readonly && content && (
            <button onClick={() => { setEditVal(content); setEditing(true); }} style={s.smallBtn}>
              Editar
            </button>
          )}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: '#16213e',
    borderBottom: '1px solid #333',
  },
  main: { flex: 1, display: 'flex', gap: 16, padding: 16, minHeight: 0 },
  videoPanel: {
    flex: '0 0 380px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#16213e',
    borderRadius: 8,
    padding: 12,
  },
  videoBox: { position: 'relative', background: '#0f3460', borderRadius: 8, overflow: 'hidden' },
  video: { width: '100%', display: 'block', maxHeight: 200 },
  videoLabel: { position: 'absolute', bottom: 4, left: 4, fontSize: 12, background: 'rgba(0,0,0,.6)', padding: '2px 6px' },
  controls: { display: 'flex', gap: 8 },
  controlBtn: { padding: '8px 12px', background: '#0f3460', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' },
  deviceControls: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 },
  deviceLabel: { fontSize: 12, color: '#aaa' },
  deviceSelect: {
    padding: '6px 8px',
    fontSize: 13,
    background: '#0f3460',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#eee',
    cursor: 'pointer',
  },
  rightPanel: { flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },
  section: { background: '#16213e', borderRadius: 8, padding: 12 },
  sectionTitle: { margin: '0 0 8px', fontSize: 16 },
  sectionCount: { color: '#aaa', fontSize: 14, fontWeight: 'normal', marginLeft: 4 },
  summaryBox: { background: '#0f3460', padding: 12, borderRadius: 6, marginBottom: 8 },
  summaryText: { margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  transcriptionBox: { maxHeight: 160, overflowY: 'auto', fontSize: 14, marginBottom: 8 },
  hint: { color: '#888', fontSize: 13 },
  transcriptionLine: { marginBottom: 4 },
  inputRow: { display: 'flex', gap: 8 },
  textInput: { flex: 1, padding: 8, background: '#0f3460', border: '1px solid #333', borderRadius: 6, color: '#eee' },
  sendBtn: { padding: '8px 16px', background: '#0f3460', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' },
  historiaBox: { maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  seccionCard: { background: '#0f3460', padding: 10, borderRadius: 6 },
  seccionCardActive: { border: '2px solid #f39c12', boxShadow: '0 0 8px rgba(243,156,12,0.3)' },
  seccionName: { margin: '0 0 6px', fontSize: 13 },
  seccionActiveLabel: { color: '#f39c12', fontSize: 12, fontWeight: 'normal' },
  seccionContent: { margin: '0 0 8px', whiteSpace: 'pre-wrap', fontSize: 13 },
  actions: { display: 'flex', gap: 8, marginBottom: 4 },
  acceptBtn: { padding: '4px 10px', background: '#27ae60', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' },
  rejectBtn: { padding: '4px 10px', background: '#c0392b', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' },
  smallBtn: { marginRight: 8, padding: '4px 8px', fontSize: 12, background: '#333', border: 'none', borderRadius: 4, color: '#eee', cursor: 'pointer' },
  textarea: { width: '100%', padding: 8, background: '#1a1a2e', border: '1px solid #333', borderRadius: 6, color: '#eee', marginBottom: 4 },
  btn: { padding: '8px 16px', background: '#c0392b', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' },
  error: { color: '#e74c3c', padding: 24 },
  meetingId: { fontSize: 11, marginRight: 12, wordBreak: 'break-all' },
  wsOk: { color: '#27ae60', fontSize: 12, fontWeight: 'normal', marginLeft: 8 },
  wsOff: { color: '#e74c3c', fontSize: 12, fontWeight: 'normal', marginLeft: 8 },
  agentOk: { color: '#27ae60', fontSize: 12, fontWeight: 'normal', marginLeft: 8 },
  agentListening: { color: '#f39c12', fontSize: 12, fontWeight: 'normal', marginLeft: 8 },
  agentIdle: { color: '#888', fontSize: 12, fontWeight: 'normal', marginLeft: 8 },
};
