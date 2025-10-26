import { useEffect, useRef, useState, useCallback } from 'react';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
  onMessage?: (data: any) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnectAttempts = 5,
    reconnectInterval = 3000,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<any>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isConnectingRef = useRef(false); // Prevent multiple simultaneous connections
  const shouldConnectRef = useRef(true); // Track if we should maintain connection
  const intentionalDisconnectRef = useRef(false); // Track if disconnect was intentional
  
  // Store callbacks in refs to keep connect function stable
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  
  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connections
    if (isConnectingRef.current) {
      console.log('⚠️ Connection already in progress, skipping...');
      return;
    }
    
    // Prevent connecting if already connected
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('⚠️ WebSocket already connected or connecting, skipping...');
      return;
    }
    
    console.log('🔌 Initiating WebSocket connection...');
    isConnectingRef.current = true;
    shouldConnectRef.current = true;
    intentionalDisconnectRef.current = false; // Reset intentional disconnect flag
    
    // TODO: Get WebSocket URL from environment variable
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
    
    try {
      setConnectionStatus('connecting');
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        isConnectingRef.current = false;
        setConnectionStatus('connected');
        reconnectCountRef.current = 0;
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        const data = event.data;
        setLastMessage(data);
        onMessageRef.current?.(data);
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        isConnectingRef.current = false;
        setConnectionStatus('error');
        onErrorRef.current?.(error);
      };

      ws.onclose = (event) => {
        console.log(`🔌 WebSocket disconnected - Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}, Clean: ${event.wasClean}`);
        isConnectingRef.current = false;
        setConnectionStatus('disconnected');
        onCloseRef.current?.();

        // Only attempt to reconnect if:
        // 1. We should maintain connection (shouldConnectRef)
        // 2. Disconnect was NOT intentional (intentionalDisconnectRef)
        // 3. We haven't exceeded max reconnection attempts
        if (!intentionalDisconnectRef.current && shouldConnectRef.current && reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current += 1;
          console.log(`🔄 Reconnecting... Attempt ${reconnectCountRef.current}/${reconnectAttempts}`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else if (intentionalDisconnectRef.current) {
          console.log('⏹️ Not reconnecting - connection closed intentionally');
        } else if (!shouldConnectRef.current) {
          console.log('⏹️ Not reconnecting - shouldConnect flag is false');
        } else {
          console.log('⚠️ Max reconnection attempts reached');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('❌ Failed to create WebSocket connection:', error);
      isConnectingRef.current = false;
      setConnectionStatus('error');
    }
  }, [reconnectAttempts, reconnectInterval]); // Removed callback dependencies - using refs instead

  const disconnect = useCallback(() => {
    console.log('🔌 Disconnecting WebSocket...');
    intentionalDisconnectRef.current = true; // Mark as intentional disconnect
    shouldConnectRef.current = false; // Prevent reconnection attempts
    isConnectingRef.current = false;
    reconnectCountRef.current = 0; // Reset reconnect counter
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    
    if (wsRef.current) {
      // Nullify event handlers to prevent reconnect logic from firing
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      
      // Only close if connection is open or connecting
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'Client initiated disconnect');
        console.log('✅ WebSocket closed');
      }
      wsRef.current = null;
    }
    
    setConnectionStatus('disconnected');
  }, []);

  const sendMessage = useCallback((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    } else {
      console.warn('WebSocket is not connected. Cannot send message.');
    }
  }, []);

  useEffect(() => {
    console.log('🎯 useWebSocket: Effect running - establishing connection');
    connect();

    return () => {
      console.log('🧹 useWebSocket: Cleanup initiated');
      
      // Manual cleanup - don't call disconnect() to avoid dependency issues
      console.log('   Setting intentional disconnect flags...');
      intentionalDisconnectRef.current = true;
      shouldConnectRef.current = false;
      isConnectingRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        console.log('   Clearing reconnect timeout...');
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      
      if (wsRef.current) {
        const currentState = wsRef.current.readyState;
        console.log('   Current WebSocket state:', {
          readyState: currentState,
          CONNECTING: WebSocket.CONNECTING,
          OPEN: WebSocket.OPEN,
          CLOSING: WebSocket.CLOSING,
          CLOSED: WebSocket.CLOSED
        });
        
        // Nullify event handlers to prevent reconnect logic during cleanup
        console.log('   Nullifying event handlers...');
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        
        if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
          console.log('   Closing WebSocket connection...');
          wsRef.current.close(1000, 'Component unmounting');
          console.log('✅ WebSocket close() called');
        } else {
          console.log('   WebSocket already closing/closed, skipping close() call');
        }
        
        console.log('   Nullifying wsRef...');
        wsRef.current = null;
      } else {
        console.log('   No WebSocket to clean up (wsRef.current is null)');
      }
      
      console.log('   Setting connection status to disconnected...');
      setConnectionStatus('disconnected');
      console.log('✅ useWebSocket: Cleanup complete');
    };
  }, [connect]); // Only depend on connect, cleanup is manual

  return {
    connectionStatus,
    lastMessage,
    sendMessage,
    disconnect,
    reconnect: connect,
  };
}
