import { useState } from 'react';

interface HomeProps {
  onStartMeeting: (meetingId: string, externalMeetingId: string) => void;
  onJoinMeeting: (meetingId: string) => void;
  onRoleChange: (r: 'medico' | 'paciente') => void;
  onPatientIdChange: (id: string) => void;
  role: 'medico' | 'paciente';
  patientId: string;
}

export default function Home({
  onStartMeeting,
  onJoinMeeting,
  onRoleChange,
  onPatientIdChange,
  role,
  patientId,
}: HomeProps) {
  const [joinId, setJoinId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/chime/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      onStartMeeting(data.meetingId, data.externalMeetingId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear reunión');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = () => {
    setError('');
    const id = joinId.trim();
    if (!id) {
      setError('Escribe el ID de la reunión');
      return;
    }
    onJoinMeeting(id);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Video Consulta - POC</h1>
      <p style={styles.subtitle}>Videollamada médica con IA (sin login)</p>

      <div style={styles.card}>
        <label style={styles.label}>Rol</label>
        <select
          value={role}
          onChange={(e) => onRoleChange(e.target.value as 'medico' | 'paciente')}
          style={styles.select}
        >
          <option value="medico">Médico</option>
          <option value="paciente">Paciente</option>
        </select>
      </div>

      {role === 'medico' && (
        <div style={styles.card}>
          <label style={styles.label}>ID paciente (mock)</label>
          <input
            type="text"
            value={patientId}
            onChange={(e) => onPatientIdChange(e.target.value)}
            style={styles.input}
            placeholder="1 o 2"
          />
        </div>
      )}

      <div style={styles.actions}>
        <button onClick={handleStart} disabled={loading} style={styles.btnPrimary}>
          {loading ? 'Creando…' : 'Iniciar nueva videollamada'}
        </button>
      </div>

      <hr style={styles.hr} />

      <div style={styles.card}>
        <label style={styles.label}>Unirse a videollamada (Meeting ID)</label>
        <input
          type="text"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="Pega el Meeting ID"
          style={styles.input}
        />
        <button onClick={handleJoin} style={styles.btnSecondary}>
          Unirse
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 420,
    margin: '40px auto',
    padding: 24,
  },
  title: { fontSize: 24, marginBottom: 4 },
  subtitle: { color: '#888', marginBottom: 24 },
  card: { marginBottom: 16 },
  label: { display: 'block', marginBottom: 4, fontSize: 14 },
  select: {
    width: '100%',
    padding: 10,
    fontSize: 16,
    background: '#16213e',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#eee',
  },
  input: {
    width: '100%',
    padding: 10,
    fontSize: 16,
    background: '#16213e',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#eee',
    marginBottom: 8,
  },
  actions: { marginTop: 8 },
  btnPrimary: {
    width: '100%',
    padding: 14,
    fontSize: 16,
    background: '#0f3460',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  btnSecondary: {
    width: '100%',
    padding: 10,
    fontSize: 14,
    background: '#16213e',
    color: '#eee',
    border: '1px solid #444',
    borderRadius: 8,
    cursor: 'pointer',
  },
  hr: { border: 'none', borderTop: '1px solid #333', margin: '24px 0' },
  error: { color: '#e74c3c', marginTop: 8 },
};
