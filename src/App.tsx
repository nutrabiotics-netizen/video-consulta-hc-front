import { useState } from 'react';
import Home from './views/Home';
import Call from './views/Call';

export type View = 'home' | 'call';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [meetingId, setMeetingId] = useState<string>('');
  const [externalMeetingId, setExternalMeetingId] = useState<string>('');
  const [role, setRole] = useState<'medico' | 'paciente'>('medico');
  const [patientId, setPatientId] = useState('1');

  if (view === 'call' && meetingId) {
    return (
      <Call
        meetingId={meetingId}
        externalMeetingId={externalMeetingId}
        role={role}
        patientId={patientId}
        onLeave={() => {
          setView('home');
          setMeetingId('');
          setExternalMeetingId('');
        }}
      />
    );
  }

  return (
    <Home
      onStartMeeting={(id, extId) => {
        setMeetingId(id);
        setExternalMeetingId(extId);
        setRole('medico');
        setView('call');
      }}
      onJoinMeeting={(id) => {
        setMeetingId(id);
        setExternalMeetingId(id);
        setRole('paciente');
        setView('call');
      }}
      onRoleChange={setRole}
      onPatientIdChange={setPatientId}
      role={role}
      patientId={patientId}
    />
  );
}
