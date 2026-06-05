import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../lib/syncClient';

interface ChatSidebarProps {
  messages: ChatMessage[];
  inRoom: boolean;
  onSend: (text: string) => void;
}

export default function ChatSidebar({
  messages,
  inRoom,
  onSend,
}: ChatSidebarProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !inRoom) return;
    onSend(text);
    setDraft('');
  };

  return (
    <aside className="chat-sidebar">
      <header className="chat-header">
        <h2>Chat</h2>
        <span className={`chat-status ${inRoom ? 'online' : ''}`}>
          {inRoom ? 'Live' : 'Offline'}
        </span>
      </header>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet. Say hello to the room.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="chat-message">
              <div className="chat-message-meta">
                <strong>{message.username}</strong>
                <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
              </div>
              <p>{message.text}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder={inRoom ? 'Type a message...' : 'Join a room to chat'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!inRoom}
        />
        <button type="submit" disabled={!inRoom || !draft.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
