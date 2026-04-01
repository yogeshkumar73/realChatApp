import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { Send, Users, LogOut, Phone, Video, UserPlus, Check, X, MessageSquare, Shield, ShieldAlert, Settings, Image as ImageIcon, Music, Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import ReactPlayer from 'react-player';

type AppUser = {
  id: string;
  username: string;
  profile_name: string;
  bio: string;
  avatar: string;
  connection_status: 'pending' | 'accepted' | 'rejected' | null;
  sender_id: string | null;
  isOnline: boolean;
  role: 'admin' | 'user';
  is_suspended: number;
};

type Message = {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: string;
};

type Chatroom = {
  id: string;
  name: string;
  code: string;
  created_by: string;
  created_at: string;
  music_url?: string;
};

type ChatroomMessage = {
  id: string;
  chatroom_id: string;
  sender_id: string;
  content: string;
  image_url?: string;
  created_at: string;
  username: string;
  profile_name: string;
  avatar: string;
};

type RoomMember = {
  id: string;
  username: string;
  profile_name: string;
  avatar: string;
};

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  username?: string;
  profile_name?: string;
};

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]); // For admin panel
  const [activeChat, setActiveChat] = useState<AppUser | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');

  // New State
  const [activeTab, setActiveTab] = useState<'chat' | 'rooms' | 'help' | 'admin'>('chat');
  const [chatrooms, setChatrooms] = useState<Chatroom[]>([]);
  const [activeRoom, setActiveRoom] = useState<Chatroom | null>(null);
  const [roomMessages, setRoomMessages] = useState<Record<string, ChatroomMessage[]>>({});
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');

  // Room specific state
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [editRoomName, setEditRoomName] = useState('');
  const [editMusicUrl, setEditMusicUrl] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WebRTC State
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState('');
  const [callerSignal, setCallerSignal] = useState<any>();
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [callType, setCallType] = useState<'video' | 'voice'>('video');
  const [stream, setStream] = useState<MediaStream | null>(null);

  const myVideo = useRef<HTMLVideoElement>(null);
  const userVideo = useRef<HTMLVideoElement>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const fetchUsers = React.useCallback(async () => {
    try {
      const res = await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  }, [token]);

  const fetchAllUsers = React.useCallback(async () => {
    try {
      const res = await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data);
      }
    } catch (err) {
      console.error('Failed to fetch all users:', err);
    }
  }, [token]);

  const fetchChatrooms = React.useCallback(async () => {
    try {
      const res = await fetch('/api/chatrooms', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChatrooms(data);
      }
    } catch (err) {
      console.error('Failed to fetch chatrooms:', err);
    }
  }, [token]);

  const fetchTickets = React.useCallback(async () => {
    try {
      const res = await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/tickets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (err) {
      console.error('Failed to fetch tickets:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchUsers();
    fetchChatrooms();
    fetchTickets();
    if (user?.role === 'admin') {
      fetchAllUsers();
    }

    const newSocket = io({
      auth: {
        token
      }
    });
    setSocket(newSocket);

    newSocket.on('connect_error', (err) => {
      if (err.message === 'Authentication error' || err.message === 'Account suspended') {
        logout();
      }
    });

    newSocket.on('user_status', ({ userId, status }) => {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isOnline: status === 'online' } : u));
    });

    newSocket.on('receive_message', (msg: Message) => {
      const otherId = msg.senderId === user?.id ? msg.receiverId : msg.senderId;
      setMessages(prev => ({
        ...prev,
        [otherId]: [...(prev[otherId] || []), msg]
      }));
    });

    newSocket.on('receive_room_message', (msg: ChatroomMessage) => {
      setRoomMessages(prev => ({
        ...prev,
        [msg.chatroom_id]: [...(prev[msg.chatroom_id] || []), msg]
      }));
    });

    newSocket.on('room_updated', (data) => {
      setChatrooms(prev => prev.map(r => r.id === data.id ? { ...r, name: data.name, music_url: data.music_url } : r));
      setActiveRoom(prev => prev?.id === data.id ? { ...prev, name: data.name, music_url: data.music_url } : prev);
    });

    newSocket.on('force_logout', () => {
      logout();
    });

    newSocket.on('call_user', (data) => {
      if (data.signal.type === 'offer') {
        setReceivingCall(true);
        setCaller(data.from);
        setCallerSignal(data.signal);
        setCallType(data.type);
      } else if (data.signal.type === 'candidate') {
        if (connectionRef.current) {
          connectionRef.current.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        } else {
          pendingCandidates.current.push(data.signal.candidate);
        }
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [user, fetchUsers, fetchAllUsers, logout]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChat]);

  const handleSuspend = async (id: string, isSuspended: number) => {
    try {
      const endpoint = isSuspended ? 'activate' : 'suspend';
      const res = await fetch(`https://illustrious-pony-fb2b02.netlify.app/register/api/admin/users/${id}/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to suspend/activate user');
      }
      fetchAllUsers();
    } catch (err) {
      console.error('Failed to suspend/activate user:', err);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
      }
      fetchAllUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this room?')) return;
    try {
      const res = await fetch(`/api/admin/chatrooms/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to delete room');
      }
      fetchChatrooms();
    } catch (err) {
      console.error('Failed to delete room:', err);
    }
  };

  const handleConnect = async (receiverId: string) => {
    try {
      await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/connections/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receiverId })
      });
      fetchUsers();
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  };

  const handleAccept = async (senderId: string) => {
    try {
      await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/connections/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ senderId })
      });
      fetchUsers();
    } catch (err) {
      console.error('Failed to accept:', err);
    }
  };

  const handleReject = async (senderId: string) => {
    try {
      await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/connections/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ senderId })
      });
      fetchUsers();
    } catch (err) {
      console.error('Failed to reject:', err);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setSelectedImage(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleUpdateRoomSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    try {
      const res = await fetch(`https://illustrious-pony-fb2b02.netlify.app/register/api/chatrooms/${activeRoom.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: editRoomName, music_url: editMusicUrl })
      });
      if (res.ok) {
        setShowRoomSettings(false);
      }
    } catch (err) {
      console.error('Failed to update room settings:', err);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && socket && activeChat && activeTab === 'chat') {
      socket.emit('send_message', { receiverId: activeChat.id, text: inputText.trim() });
      setInputText('');
    } else if ((inputText.trim() || selectedImage) && socket && activeRoom && activeTab === 'rooms') {
      socket.emit('send_room_message', { roomId: activeRoom.id, text: inputText.trim(), image_url: selectedImage });
      setInputText('');
      setSelectedImage(null);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    try {
      const res = await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/chatrooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newRoomName.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setNewRoomName('');
        fetchChatrooms();
        if (data.room) {
          selectRoom(data.room);
        }
      }
    } catch (err) {
      console.error('Failed to create room:', err);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinRoomCode.trim()) return;
    try {
      const res = await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/chatrooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: joinRoomCode.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setJoinRoomCode('');
        fetchChatrooms();
        if (data.room) {
          selectRoom(data.room);
        }
      }
    } catch (err) {
      console.error('Failed to join room:', err);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    try {
      const res = await fetch('https://illustrious-pony-fb2b02.netlify.app/register/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject: ticketSubject.trim(), message: ticketMessage.trim() })
      });
      if (res.ok) {
        setTicketSubject('');
        setTicketMessage('');
        fetchTickets();
      }
    } catch (err) {
      console.error('Failed to create ticket:', err);
    }
  };

  const handleResolveTicket = async (id: string) => {
    try {
      await fetch(`https://illustrious-pony-fb2b02.netlify.app/api/admin/tickets/${id}/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchTickets();
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
    }
  };

  const selectRoom = async (room: Chatroom) => {
    setActiveRoom(room);
    setEditRoomName(room.name);
    setEditMusicUrl(room.music_url || '');
    setShowRoomSettings(false);
    if (socket) {
      socket.emit('join_room', room.id);
    }
    try {
      const res = await fetch(`https://illustrious-pony-fb2b02.netlify.app/api/chatrooms/${room.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRoomMessages(prev => ({ ...prev, [room.id]: data }));
      }
      const membersRes = await fetch(`https://illustrious-pony-fb2b02.netlify.app/api/chatrooms/${room.id}/members`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (membersRes.ok) {
        const membersData = await membersRes.json();
        setRoomMembers(membersData);
      }
    } catch (err) {
      console.error('Failed to fetch room messages:', err);
    }
  };

  // WebRTC Logic
  const setupMedia = async (type: 'video' | 'voice') => {
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({
        video: type === 'video',
        audio: true
      });
      setStream(currentStream);
      if (myVideo.current) {
        myVideo.current.srcObject = currentStream;
      }
      return currentStream;
    } catch (err) {
      console.error("Failed to get media", err);
      return null;
    }
  };

  const callUser = async (idToCall: string, type: 'video' | 'voice') => {
    const currentStream = await setupMedia(type);
    if (!currentStream) return;

    setCallType(type);
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    connectionRef.current = peer;

    currentStream.getTracks().forEach(track => peer.addTrack(track, currentStream));

    peer.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('call_user', {
          userToCall: idToCall,
          signalData: { type: 'candidate', candidate: event.candidate },
          type
        });
      }
    };

    peer.ontrack = (event) => {
      if (userVideo.current) {
        userVideo.current.srcObject = event.streams[0];
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket?.emit('call_user', {
      userToCall: idToCall,
      signalData: { type: 'offer', offer },
      type
    });

    socket?.on('call_accepted', async (signal) => {
      setCallAccepted(true);
      if (signal.type === 'answer') {
        await peer.setRemoteDescription(new RTCSessionDescription(signal.answer));
        pendingCandidates.current.forEach(candidate => {
          peer.addIceCandidate(new RTCIceCandidate(candidate));
        });
        pendingCandidates.current = [];
      } else if (signal.type === 'candidate') {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          pendingCandidates.current.push(signal.candidate);
        }
      }
    });
  };

  const answerCall = async () => {
    setCallAccepted(true);
    const currentStream = await setupMedia(callType);
    if (!currentStream) return;

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    connectionRef.current = peer;

    currentStream.getTracks().forEach(track => peer.addTrack(track, currentStream));

    peer.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('answer_call', {
          to: caller,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    peer.ontrack = (event) => {
      if (userVideo.current) {
        userVideo.current.srcObject = event.streams[0];
      }
    };

    if (callerSignal?.type === 'offer') {
      await peer.setRemoteDescription(new RTCSessionDescription(callerSignal.offer));

      pendingCandidates.current.forEach(candidate => {
        peer.addIceCandidate(new RTCIceCandidate(candidate));
      });
      pendingCandidates.current = [];

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket?.emit('answer_call', { to: caller, signal: { type: 'answer', answer } });
    }
  };

  const leaveCall = () => {
    setCallEnded(true);
    connectionRef.current?.close();
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    socket?.emit('end_call', { to: activeChat?.id || caller });
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-80 bg-white border-r border-slate-200 flex flex-col h-screen">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <img src={user?.avatar || 'https://picsum.photos/seed/chat/200'} alt="Profile" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
            <div>
              <h3 className="font-semibold text-slate-800 flex items-center gap-1">
                {user?.profile_name}
                {user?.role === 'admin' && <Shield className="w-3 h-3 text-blue-600" />}
              </h3>
              <p className="text-xs text-slate-500">@{user?.username}</p>
            </div>
          </div>
          <button onClick={logout} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${activeTab === 'chat' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab('rooms')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${activeTab === 'rooms' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Rooms
          </button>
          <button
            onClick={() => setActiveTab('help')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${activeTab === 'help' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
          >
            Help
          </button>
        </div>

        {user?.role === 'admin' && (
          <div className="p-2 border-b border-slate-200">
            <button
              onClick={() => setActiveTab('admin')}
              className={`w-full py-2 px-4 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'admin' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              <ShieldAlert className="w-4 h-4" />
              Admin Panel
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'chat' && (
            <>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">People</h4>
              <ul className="space-y-3">
                {users.map((u) => (
                  <li key={u.id} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <img src={u.avatar || 'https://picsum.photos/seed/chat/200'} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                          {u.isOnline && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>}
                        </div>
                        <div>
                          <h5 className="font-medium text-slate-800 text-sm flex items-center gap-1">
                            {u.profile_name}
                            {u.role === 'admin' && <Shield className="w-3 h-3 text-blue-600" />}
                          </h5>
                          <p className="text-xs text-slate-500">@{u.username}</p>
                        </div>
                      </div>
                    </div>

                    {/* Connection Actions */}
                    <div className="mt-2 flex gap-2">
                      {!u.connection_status && (
                        <button onClick={() => handleConnect(u.id)} className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium py-1.5 rounded-lg flex items-center justify-center gap-1">
                          <UserPlus className="w-3 h-3" /> Connect
                        </button>
                      )}
                      {u.connection_status === 'pending' && u.sender_id === user?.id && (
                        <span className="flex-1 text-center text-xs text-slate-500 bg-slate-50 py-1.5 rounded-lg">Request Sent</span>
                      )}
                      {u.connection_status === 'pending' && u.sender_id !== user?.id && (
                        <div className="flex w-full gap-2">
                          <button onClick={() => handleAccept(u.sender_id!)} className="flex-1 bg-green-500 hover:bg-green-600 text-white text-xs font-medium py-1.5 rounded-lg flex items-center justify-center gap-1">
                            <Check className="w-3 h-3" /> Accept
                          </button>
                          <button onClick={() => handleReject(u.sender_id!)} className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium py-1.5 rounded-lg flex items-center justify-center gap-1">
                            <X className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      )}
                      {u.connection_status === 'accepted' && (
                        <button onClick={() => setActiveChat(u)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 rounded-lg flex items-center justify-center gap-1">
                          <MessageSquare className="w-3 h-3" /> Message
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {activeTab === 'rooms' && (
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Create Room</h4>
                <form onSubmit={handleCreateRoom} className="flex gap-2">
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="Room Name"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button type="submit" className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Create</button>
                </form>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Join Room</h4>
                <form onSubmit={handleJoinRoom} className="flex gap-2">
                  <input
                    type="text"
                    value={joinRoomCode}
                    onChange={(e) => setJoinRoomCode(e.target.value)}
                    placeholder="Room Code"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  />
                  <button type="submit" className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700">Join</button>
                </form>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">My Rooms</h4>
                {chatrooms.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">No rooms joined yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {chatrooms.map(room => (
                      <li key={room.id}>
                        <button
                          onClick={() => selectRoom(room)}
                          className={`w-full text-left p-3 rounded-xl border transition-colors ${activeRoom?.id === room.id ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:bg-slate-50'}`}
                        >
                          <div className="font-medium text-slate-800 text-sm">{room.name}</div>
                          <div className="text-xs text-slate-500 mt-1">Code: <span className="font-mono font-semibold">{room.code}</span></div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === 'help' && (
            <div className="text-center py-8">
              <ShieldAlert className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-medium text-slate-800">Need Help?</h3>
              <p className="text-xs text-slate-500 mt-1">Submit a ticket in the main area.</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col h-screen relative">
        {/* Incoming Call Overlay */}
        {receivingCall && !callAccepted && (
          <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white p-8 rounded-2xl shadow-2xl text-center space-y-6 max-w-sm w-full mx-4">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
                {callType === 'video' ? <Video className="w-10 h-10 text-blue-600" /> : <Phone className="w-10 h-10 text-blue-600" />}
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Incoming {callType} call</h3>
                <p className="text-slate-500">Someone is calling you...</p>
              </div>
              <div className="flex gap-4">
                <button onClick={answerCall} className="flex-1 bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
                  <Phone className="w-5 h-5" /> Answer
                </button>
                <button onClick={() => setReceivingCall(false)} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
                  <X className="w-5 h-5" /> Decline
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Call UI */}
        {(callAccepted || stream) && !callEnded && (
          <div className="absolute inset-0 z-40 bg-slate-900 flex flex-col">
            <div className="flex-1 relative flex items-center justify-center p-4 gap-4">
              {callType === 'video' && (
                <>
                  <div className="relative w-full max-w-3xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl">
                    <video playsInline ref={userVideo} autoPlay className="w-full h-full object-cover" />
                    <div className="absolute bottom-4 left-4 text-white bg-black/50 px-3 py-1 rounded-lg text-sm">Remote</div>
                  </div>
                  <div className="absolute top-4 right-4 w-48 aspect-video bg-black rounded-xl overflow-hidden shadow-xl border-2 border-slate-700">
                    <video playsInline muted ref={myVideo} autoPlay className="w-full h-full object-cover" />
                  </div>
                </>
              )}
              {callType === 'voice' && (
                <div className="text-center space-y-4">
                  <div className="w-32 h-32 bg-slate-800 rounded-full flex items-center justify-center mx-auto animate-pulse">
                    <Phone className="w-12 h-12 text-blue-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Voice Call Active</h2>
                  <audio playsInline ref={userVideo} autoPlay className="hidden" />
                  <audio playsInline muted ref={myVideo} autoPlay className="hidden" />
                </div>
              )}
            </div>
            <div className="p-6 flex justify-center bg-gradient-to-t from-black/80 to-transparent">
              <button onClick={leaveCall} className="bg-red-500 hover:bg-red-600 text-white p-4 rounded-full shadow-lg transition-transform hover:scale-105">
                <Phone className="w-6 h-6 rotate-[135deg]" />
              </button>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        {activeTab === 'admin' && user?.role === 'admin' ? (
          <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
            <div className="max-w-4xl mx-auto">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                  <ShieldAlert className="w-6 h-6 text-blue-600" />
                  Admin Control Panel
                </h2>
                <p className="text-slate-500 mt-1">Manage all user accounts, platform access, and support tickets.</p>
              </div>

              <div className="space-y-8">
                {/* Safety Feature Section */}
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 flex items-start gap-3">
                  <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-blue-900 text-sm">Safety Feature Active</h3>
                    <p className="text-blue-700 text-xs mt-1">
                      The super admin account (username: <strong>admin</strong>) is protected by a constant ID section function. This account cannot be suspended or deleted by any user, ensuring platform stability and continuous administrative access.
                    </p>
                  </div>
                </div>

                {/* Users Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-semibold text-slate-800">User Management</h3>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-4 font-semibold text-slate-600 text-sm">User</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm">Role</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm">Status</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allUsers.map(u => (
                        <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs">
                                {u.username.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-slate-800">{u.profile_name || 'No Profile'}</div>
                                <div className="text-xs text-slate-500">@{u.username}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.is_suspended ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {u.is_suspended ? 'Suspended' : 'Active'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            {u.id !== user?.id && u.username !== 'admin' && (
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleSuspend(u.id, u.is_suspended)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${u.is_suspended ? 'bg-green-50 hover:bg-green-100 text-green-600' : 'bg-red-50 hover:bg-red-100 text-red-600'}`}
                                >
                                  {u.is_suspended ? 'Activate' : 'Suspend'}
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(u.id)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-red-600 hover:bg-red-700 text-white"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                            {u.username === 'admin' && (
                              <span className="text-xs text-slate-400 italic">Protected</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Chatrooms Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-semibold text-slate-800">Chatrooms Management</h3>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-4 font-semibold text-slate-600 text-sm">Room Name</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm">Code</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chatrooms.map(room => (
                        <tr key={room.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="p-4">
                            <div className="font-medium text-slate-800">{room.name}</div>
                          </td>
                          <td className="p-4">
                            <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-mono">{room.code}</span>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => handleDeleteRoom(room.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-red-50 hover:bg-red-100 text-red-600"
                            >
                              Delete Room
                            </button>
                          </td>
                        </tr>
                      ))}
                      {chatrooms.length === 0 && (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-slate-500 text-sm">No chatrooms found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Support Tickets Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-semibold text-slate-800">Support Tickets</h3>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-4 font-semibold text-slate-600 text-sm">User</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm">Subject</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm">Status</th>
                        <th className="p-4 font-semibold text-slate-600 text-sm text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map(t => (
                        <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="p-4">
                            <div className="font-medium text-slate-800">{t.profile_name}</div>
                            <div className="text-xs text-slate-500">@{t.username}</div>
                          </td>
                          <td className="p-4">
                            <div className="font-medium text-slate-800">{t.subject}</div>
                            <div className="text-xs text-slate-500 truncate max-w-xs">{t.message}</div>
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${t.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                              {t.status}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            {t.status !== 'resolved' && (
                              <button
                                onClick={() => handleResolveTicket(t.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-blue-50 hover:bg-blue-100 text-blue-600"
                              >
                                Mark Resolved
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {tickets.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500">No support tickets found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'help' ? (
          <div className="flex-1 overflow-y-auto p-8 bg-slate-50">
            <div className="max-w-3xl mx-auto space-y-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold text-slate-800 mb-2">Submit a Support Ticket</h2>
                <p className="text-slate-500 text-sm mb-6">Describe your problem and our team will help you solve it.</p>
                <form onSubmit={handleCreateTicket} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={ticketSubject}
                      onChange={(e) => setTicketSubject(e.target.value)}
                      required
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Brief description of the issue"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                    <textarea
                      value={ticketMessage}
                      onChange={(e) => setTicketMessage(e.target.value)}
                      required
                      rows={4}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Provide details about your problem..."
                    />
                  </div>
                  <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors">
                    Submit Ticket
                  </button>
                </form>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50">
                  <h3 className="font-semibold text-slate-800">My Tickets</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {tickets.map(t => (
                    <div key={t.id} className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-medium text-slate-800">{t.subject}</h4>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${t.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {t.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mb-2">{t.message}</p>
                      <div className="text-xs text-slate-400">
                        Submitted on {format(new Date(t.created_at), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                  ))}
                  {tickets.length === 0 && (
                    <div className="p-8 text-center text-slate-500">You haven't submitted any tickets yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'rooms' ? (
          activeRoom ? (
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col relative">
                <div className="bg-white border-b border-slate-200 p-4 shadow-sm z-10 flex justify-between items-center">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800">{activeRoom.name}</h2>
                    <p className="text-xs text-slate-500">Room Code: <span className="font-mono font-semibold">{activeRoom.code}</span></p>
                  </div>
                  {activeRoom.created_by === user?.id && (
                    <button onClick={() => setShowRoomSettings(!showRoomSettings)} className={`p-2 rounded-lg transition-colors ${showRoomSettings ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50'}`}>
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                  {(!roomMessages[activeRoom.id] || roomMessages[activeRoom.id].length === 0) ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                      <MessageSquare className="w-12 h-12 opacity-20" />
                      <p>Welcome to {activeRoom.name}. Start chatting!</p>
                    </div>
                  ) : (
                    roomMessages[activeRoom.id].map((msg, index) => {
                      const isMe = msg.sender_id === user?.id;
                      return (
                        <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                          <div className="flex items-baseline gap-2 mb-1">
                            {!isMe && <span className="text-xs font-medium text-slate-600">{msg.profile_name}</span>}
                            <span className="text-xs text-slate-400">
                              {format(new Date(msg.created_at), 'h:mm a')}
                            </span>
                          </div>
                          <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white text-slate-800 border border-slate-100 rounded-tl-sm'}`}>
                            {msg.image_url && (
                              <img src={msg.image_url} alt="Shared image" className="rounded-lg max-w-full h-auto mb-2" />
                            )}
                            {msg.content && <p className="break-words">{msg.content}</p>}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="bg-white p-4 border-t border-slate-200">
                  {selectedImage && (
                    <div className="mb-3 relative inline-block">
                      <img src={selectedImage} alt="Preview" className="h-24 rounded-lg border border-slate-200 object-cover" />
                      <button type="button" onClick={() => setSelectedImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <form onSubmit={sendMessage} className="flex gap-2 max-w-4xl mx-auto items-center">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleImageSelect}
                    />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-500 hover:text-blue-600 transition-colors rounded-full hover:bg-slate-100">
                      <ImageIcon className="w-5 h-5" />
                    </button>
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Type a message to the room..."
                      className="flex-1 bg-slate-100 border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-full px-6 py-3 outline-none transition-all"
                    />
                    <button type="submit" disabled={!inputText.trim() && !selectedImage} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-full p-3 transition-colors flex items-center justify-center shadow-sm">
                      <Send className="w-5 h-5" />
                    </button>
                  </form>
                </div>
              </div>

              {/* Room Sidebar */}
              <div className="w-64 bg-white border-l border-slate-200 flex flex-col h-full">
                {showRoomSettings && activeRoom.created_by === user?.id && (
                  <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-semibold text-slate-800 mb-3 text-sm">Room Settings</h3>
                    <form onSubmit={handleUpdateRoomSettings} className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Room Name</label>
                        <input type="text" value={editRoomName} onChange={e => setEditRoomName(e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Music URL (Audio)</label>
                        <input type="text" value={editMusicUrl} onChange={e => setEditMusicUrl(e.target.value)} placeholder="https://..." className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <button type="submit" className="w-full bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors">Save Settings</button>
                    </form>
                  </div>
                )}

                {activeRoom.music_url && (
                  <div className="p-4 border-b border-slate-200 bg-blue-50">
                    <h3 className="text-xs font-semibold text-blue-800 uppercase mb-2 flex items-center gap-1">
                      <Music className="w-3 h-3" /> Room Audio
                    </h3>
                    <div className="w-full h-12 rounded overflow-hidden">
                      <ReactPlayer
                        url={activeRoom.music_url}
                        playing={true}
                        controls={true}
                        loop={true}
                        width="100%"
                        height="100%"
                        config={{
                          youtube: {
                            playerVars: { showinfo: 1 }
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Members ({roomMembers.length})</h3>
                  <ul className="space-y-3">
                    {roomMembers.map(member => (
                      <li key={member.id} className="flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                          <img src={member.avatar} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                          <div className="text-sm font-medium text-slate-800 truncate w-24" title={member.profile_name}>{member.profile_name}</div>
                        </div>
                        {member.id !== user?.id && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => callUser(member.id, 'voice')} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Voice Call">
                              <Phone className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => callUser(member.id, 'video')} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Video Call">
                              <Video className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50 p-8 text-center">
              <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                <Users className="w-12 h-12 text-blue-500" />
              </div>
              <h2 className="text-2xl font-bold text-slate-700 mb-2">Chatrooms</h2>
              <p className="text-slate-500 max-w-md mb-8">
                Create a new room or join an existing one using a room code from the sidebar.
              </p>
            </div>
          )
        ) : activeChat ? (
          /* Chat Interface */
          <>
            <div className="bg-white border-b border-slate-200 p-4 shadow-sm z-10 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <img src={activeChat.avatar || 'https://picsum.photos/seed/chat/200'} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">{activeChat.profile_name}</h2>
                  <p className="text-xs text-slate-500">{activeChat.isOnline ? 'Online' : 'Offline'}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => callUser(activeChat.id, 'voice')} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Voice Call">
                  <Phone className="w-5 h-5" />
                </button>
                <button onClick={() => callUser(activeChat.id, 'video')} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Video Call">
                  <Video className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
              {(!messages[activeChat.id] || messages[activeChat.id].length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                  <MessageSquare className="w-12 h-12 opacity-20" />
                  <p>Start a conversation with {activeChat.profile_name}</p>
                </div>
              ) : (
                messages[activeChat.id].map((msg, index) => {
                  const isMe = msg.senderId === user?.id;
                  return (
                    <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-xs text-slate-400">
                          {format(new Date(msg.timestamp), 'h:mm a')}
                        </span>
                      </div>
                      <div className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white text-slate-800 border border-slate-100 rounded-tl-sm'}`}>
                        <p className="break-words">{msg.text}</p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="bg-white p-4 border-t border-slate-200">
              <form onSubmit={sendMessage} className="flex gap-2 max-w-4xl mx-auto">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-slate-100 border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-full px-6 py-3 outline-none transition-all"
                />
                <button type="submit" disabled={!inputText.trim()} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-full p-3 transition-colors flex items-center justify-center shadow-sm">
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50 p-8 text-center">
            <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <MessageSquare className="w-12 h-12 text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-700 mb-2">Welcome to your Chat Section</h2>
            <p className="text-slate-500 max-w-md mb-8">
              To start chatting, you need to connect with other users first. Here's how:
            </p>

            <div className="grid gap-4 max-w-md w-full text-left">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex gap-4">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold shrink-0">1</div>
                <div>
                  <h4 className="font-semibold text-slate-800">Find someone</h4>
                  <p className="text-sm text-slate-500">Look at the "People" list on the left side.</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex gap-4">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold shrink-0">2</div>
                <div>
                  <h4 className="font-semibold text-slate-800">Send a request</h4>
                  <p className="text-sm text-slate-500">Click the "Connect" button next to their name.</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex gap-4">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold shrink-0">3</div>
                <div>
                  <h4 className="font-semibold text-slate-800">Wait for acceptance</h4>
                  <p className="text-sm text-slate-500">Once they accept, a "Message" button will appear. Click it to open the chat!</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
