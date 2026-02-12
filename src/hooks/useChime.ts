/**
 * Hook para unirse a una reunión AWS Chime (audio/video).
 * Flujo alineado con transcriptor-v2: permisos, startAudioInput, bindAudioElement, startVideoInput.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  DefaultMeetingSession,
  MeetingSessionConfiguration,
  ConsoleLogger,
  LogLevel,
  DefaultDeviceController,
  VideoTileState,
} from 'amazon-chime-sdk-js';
import type { ChimeMeetingInfo, ChimeAttendeeInfo } from '../api/client';

const logger = new ConsoleLogger('ChimeSession', LogLevel.WARN);

const MEETING_AUDIO_ID = 'video-consulta-meeting-audio';

export interface ChimeDeviceOptions {
  selectedAudioId?: string | null;
  selectedVideoId?: string | null;
  selectedOutputId?: string | null;
}

export function useChime(
  meetingInfo: ChimeMeetingInfo | null,
  attendeeInfo: ChimeAttendeeInfo | null,
  deviceOptions?: ChimeDeviceOptions
) {
  const [session, setSession] = useState<DefaultMeetingSession | null>(null);
  const [audioVideo, setAudioVideo] = useState<any>(null);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(false);
  const [localAudioEnabled, setLocalAudioEnabled] = useState(false);
  const [remoteTiles, setRemoteTiles] = useState<{ attendeeId: string; tileId: number }[]>([]);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<DefaultMeetingSession | null>(null);
  const meetingAudioRef = useRef<HTMLAudioElement | null>(null);

  const startSession = useCallback(async () => {
    if (!meetingInfo || !attendeeInfo) return;
    const meeting = {
      MeetingId: meetingInfo.meetingId,
      MediaRegion: meetingInfo.mediaRegion,
      MediaPlacement: {
        AudioHostUrl: meetingInfo.mediaPlacement.audioHostUrl,
        AudioFallbackUrl: meetingInfo.mediaPlacement.audioFallbackUrl,
        SignalingUrl: meetingInfo.mediaPlacement.signalingUrl,
        TurnControlUrl: meetingInfo.mediaPlacement.turnControlUrl,
      },
    };
    const attendee = {
      AttendeeId: attendeeInfo.attendeeId,
      JoinToken: attendeeInfo.joinToken,
      ExternalUserId: attendeeInfo.externalUserId || '',
    };
    const config = new MeetingSessionConfiguration(meeting, attendee);
    const deviceController = new DefaultDeviceController(logger);
    const meetingSession = new DefaultMeetingSession(config, logger, deviceController);
    sessionRef.current = meetingSession;
    setSession(meetingSession);
    const av = meetingSession.audioVideo;
    setAudioVideo(av);

    const observer = {
      audioVideoDidStart: () => {},
      audioVideoDidStop: () => {},
      videoTileDidUpdate: (tileState: VideoTileState) => {
        const tid = tileState.tileId;
        if (tid === null) return;
        const localTile = tileState.localTile;
        const isContent = tileState.isContent;
        const elLocal = localVideoRef.current;
        const elRemote = remoteVideoRef.current;
        if (localTile && elLocal) {
          av.bindVideoElement(tid, elLocal);
          setLocalVideoEnabled(true);
        } else if (!isContent && elRemote) {
          av.bindVideoElement(tid, elRemote);
          setRemoteTiles((prev) => {
            const next = prev.filter((t) => t.tileId !== tid);
            next.push({ attendeeId: tileState.boundAttendeeId || '', tileId: tid });
            return next;
          });
        }
      },
      videoTileWasRemoved: (tileId: number) => {
        setRemoteTiles((prev) => prev.filter((t) => t.tileId !== tileId));
      },
    };
    av.addObserver(observer);

    try {
      // 1) Trigger de permisos (como transcriptor-v2)
      av.setDeviceLabelTrigger(async () => {
        return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      });

      // 2) Iniciar conexión
      av.start();

      // 3) Audio: listar dispositivos y elegir el seleccionado o el primero
      const audioInputs = await av.listAudioInputDevices(true);
      setAudioInputDevices(audioInputs);
      if (audioInputs.length > 0) {
        const audioId = deviceOptions?.selectedAudioId && audioInputs.some((d) => d.deviceId === deviceOptions.selectedAudioId)
          ? deviceOptions.selectedAudioId
          : audioInputs[0].deviceId;
        try {
          await av.startAudioInput(audioId);
          av.realtimeUnmuteLocalAudio();
          setLocalAudioEnabled(true);
        } catch (e) {
          console.warn('startAudioInput falló:', e);
        }
      }

      // 4) Elemento de audio de la reunión (escuchar a otros)
      let audioEl = document.getElementById(MEETING_AUDIO_ID) as HTMLAudioElement | null;
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = MEETING_AUDIO_ID;
        audioEl.autoplay = true;
        audioEl.setAttribute('playsinline', 'true');
        document.body.appendChild(audioEl);
        meetingAudioRef.current = audioEl;
      }
      try {
        await av.bindAudioElement(audioEl);
        audioEl.volume = 1.0;
      } catch (e) {
        console.warn('bindAudioElement falló:', e);
      }

      // 5) Video: listar dispositivos, startVideoInput y startLocalVideoTile
      try {
        const videoInputs = await av.listVideoInputDevices(true);
        setVideoInputDevices(videoInputs);
        if (videoInputs.length > 0) {
          const videoId = deviceOptions?.selectedVideoId && videoInputs.some((d) => d.deviceId === deviceOptions.selectedVideoId)
            ? deviceOptions.selectedVideoId
            : videoInputs[0].deviceId;
          await av.startVideoInput(videoId);
          av.startLocalVideoTile();
          const el = localVideoRef.current;
          const tile = av.getLocalVideoTile();
          if (tile && el) {
            av.bindVideoElement(tile.id(), el);
            setLocalVideoEnabled(true);
          }
        }
      } catch (e) {
        console.warn('Video no disponible (solo audio):', e);
      }

      // 6) Audio de salida (altavoces)
      try {
        const outputDevices = await av.listAudioOutputDevices(true);
        setAudioOutputDevices(outputDevices);
        if (outputDevices.length > 0 && deviceOptions?.selectedOutputId) {
          await av.chooseAudioOutput(deviceOptions.selectedOutputId);
        }
      } catch (e) {
        console.warn('Lista de salida de audio:', e);
      }
    } catch (err) {
      console.error('Error al iniciar sesión Chime:', err);
    }
  }, [meetingInfo, attendeeInfo, deviceOptions?.selectedAudioId, deviceOptions?.selectedVideoId, deviceOptions?.selectedOutputId]);

  useEffect(() => {
    if (session && localVideoRef.current) {
      const tile = session.audioVideo.getLocalVideoTile();
      if (tile) {
        session.audioVideo.bindVideoElement(tile.id(), localVideoRef.current);
      }
    }
  }, [session]);

  useEffect(() => {
    if (!session || !remoteVideoRef.current || remoteTiles.length === 0) return;
    const tile = remoteTiles[0];
    session.audioVideo.bindVideoElement(tile.tileId, remoteVideoRef.current);
  }, [session, remoteTiles]);

  const toggleVideo = useCallback(() => {
    if (!audioVideo) return;
    if (localVideoEnabled) {
      audioVideo.stopLocalVideoTile();
      setLocalVideoEnabled(false);
    } else {
      audioVideo.startLocalVideoTile();
      const tile = audioVideo.getLocalVideoTile();
      if (tile && localVideoRef.current) {
        audioVideo.bindVideoElement(tile.id(), localVideoRef.current);
        setLocalVideoEnabled(true);
      }
    }
  }, [audioVideo, localVideoEnabled]);

  const toggleAudio = useCallback(() => {
    if (!audioVideo) return;
    if (localAudioEnabled) {
      audioVideo.realtimeMuteLocalAudio();
      setLocalAudioEnabled(false);
    } else {
      audioVideo.realtimeUnmuteLocalAudio();
      setLocalAudioEnabled(true);
    }
  }, [audioVideo, localAudioEnabled]);

  const leave = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.audioVideo.stop();
      sessionRef.current = null;
    }
    const audioEl = meetingAudioRef.current || document.getElementById(MEETING_AUDIO_ID);
    if (audioEl && audioEl.parentNode) {
      audioEl.parentNode.removeChild(audioEl);
    }
    meetingAudioRef.current = null;
    setSession(null);
    setAudioVideo(null);
    setLocalVideoEnabled(false);
    setLocalAudioEnabled(false);
    setAudioInputDevices([]);
    setVideoInputDevices([]);
    setAudioOutputDevices([]);
  }, []);

  const changeAudioInput = useCallback(async (deviceId: string) => {
    const av = sessionRef.current?.audioVideo;
    if (!av) return;
    try {
      await av.startAudioInput(deviceId);
      if (!av.realtimeIsLocalAudioMuted()) av.realtimeUnmuteLocalAudio();
    } catch (e) {
      console.warn('Error al cambiar micrófono:', e);
    }
  }, []);

  const changeVideoInput = useCallback(async (deviceId: string) => {
    const av = sessionRef.current?.audioVideo;
    if (!av) return;
    try {
      await av.startVideoInput(deviceId);
      if (av.hasStartedLocalVideoTile()) {
        const tile = av.getLocalVideoTile();
        if (tile && localVideoRef.current) av.bindVideoElement(tile.id(), localVideoRef.current);
      }
    } catch (e) {
      console.warn('Error al cambiar cámara:', e);
    }
  }, []);

  const changeAudioOutput = useCallback(async (deviceId: string | null) => {
    const av = sessionRef.current?.audioVideo;
    if (!av) return;
    try {
      await av.chooseAudioOutput(deviceId);
    } catch (e) {
      console.warn('Error al cambiar audio de salida:', e);
    }
  }, []);

  return {
    session,
    startSession,
    leave,
    localVideoRef,
    remoteVideoRef,
    localVideoEnabled,
    localAudioEnabled,
    toggleVideo,
    toggleAudio,
    audioInputDevices,
    videoInputDevices,
    audioOutputDevices,
    changeAudioInput,
    changeVideoInput,
    changeAudioOutput,
  };
}
