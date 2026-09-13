package com.rushi36.itantra

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.net.BindException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLEncoder
import java.util.concurrent.Executors
import org.json.JSONObject

class DiscoveryService : Service() {
  companion object {
    private const val TAG = "iTantraDiscovery"
    private const val CHANNEL_ID = "itantra_discovery"
    private const val CALL_CHANNEL_ID = "itantra_calls"
    private const val NOTIFICATION_ID = 5556
    private const val CALL_NOTIFICATION_ID = 5557
    private const val CALL_PORT = 5555
    private const val NSD_TYPE = "_itantra._tcp."
    private const val PREFS = "itantra_pending_call"
    private const val PREF_IP = "ip"
    private const val PREF_NAME = "name"
    const val ACTION_ACCEPT = "com.rushi36.itantra.ACCEPT_CALL"
    const val ACTION_REJECT = "com.rushi36.itantra.REJECT_CALL"
  }

  private val executor = Executors.newCachedThreadPool()
  private var callServer: ServerSocket? = null
  private var pendingSocket: Socket? = null
  private var pendingIp: String? = null
  private var pendingName: String? = null
  private var nsdManager: NsdManager? = null
  private var nsdRegistration: NsdManager.RegistrationListener? = null
  private var nsdDiscovery: NsdManager.DiscoveryListener? = null
  private var nsdStopped = true

  override fun onCreate() {
    super.onCreate()
    Log.d(TAG, "[STAGE 1] DiscoveryService.onCreate()")
    createChannels()
    Log.d(TAG, "[STAGE 2] Starting foreground service notification")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, serviceNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    else startForeground(NOTIFICATION_ID, serviceNotification())
    restorePendingCall()
    Log.d(TAG, "[STAGE 3] Starting background NSD")
    startNsd()
    Log.d(TAG, "[STAGE 4] Starting background TCP call server on :$CALL_PORT")
    startCallServer()
  }

  private fun pendingPrefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun restorePendingCall() {
    val prefs = pendingPrefs()
    val ip = prefs.getString(PREF_IP, null)
    val name = prefs.getString(PREF_NAME, null)
    if (!ip.isNullOrBlank()) {
      pendingIp = ip
      pendingName = name ?: "iTantra device"
      Log.d(TAG, "[CALL RESTORE] Restored pending call ip=$pendingIp name=$pendingName; socket=${pendingSocket != null}")
    } else {
      Log.d(TAG, "[CALL RESTORE] No persisted pending call")
    }
  }

  private fun persistPendingCall(ip: String, name: String) {
    pendingPrefs().edit().putString(PREF_IP, ip).putString(PREF_NAME, name).apply()
    Log.d(TAG, "[CALL STATE] Pending call persisted ip=$ip name=$name")
  }

  private fun clearPersistedPendingCall() {
    pendingPrefs().edit().clear().apply()
    Log.d(TAG, "[CALL STATE] Persisted pending call cleared")
  }

  private fun startNsd() {
    nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
    nsdStopped = false
    val serviceName = "iTantra-${deviceId().takeLast(8)}"
    Log.d(TAG, "[NSD] Registering service name=$serviceName type=$NSD_TYPE port=$CALL_PORT")
    try {
      val info = NsdServiceInfo().apply { this.serviceName = serviceName; serviceType = NSD_TYPE; port = CALL_PORT }
      val registration = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) { Log.d(TAG, "[NSD] REGISTERED name=${info.serviceName}") }
        override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) { Log.e(TAG, "[NSD] REGISTRATION FAILED code=$errorCode") }
        override fun onServiceUnregistered(info: NsdServiceInfo) { Log.d(TAG, "[NSD] UNREGISTERED name=${info.serviceName}") }
        override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) { Log.e(TAG, "[NSD] UNREGISTER FAILED code=$errorCode") }
      }
      nsdRegistration = registration
      nsdManager?.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration)
    } catch (e: Exception) { Log.e(TAG, "[NSD] Registration exception", e) }
    try {
      val discovery = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) { Log.d(TAG, "[NSD] DISCOVERY STARTED type=$serviceType") }
        override fun onDiscoveryStopped(serviceType: String) { Log.d(TAG, "[NSD] DISCOVERY STOPPED type=$serviceType") }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { Log.e(TAG, "[NSD] DISCOVERY START FAILED code=$errorCode"); try { nsdManager?.stopServiceDiscovery(this) } catch (_: Exception) {} }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { Log.e(TAG, "[NSD] DISCOVERY STOP FAILED code=$errorCode") }
        override fun onServiceLost(serviceInfo: NsdServiceInfo) { Log.d(TAG, "[NSD] SERVICE LOST name=${serviceInfo.serviceName}") }
        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
          if (nsdStopped || serviceInfo.serviceType != NSD_TYPE || serviceInfo.serviceName == serviceName) return
          Log.d(TAG, "[NSD] SERVICE FOUND name=${serviceInfo.serviceName} type=${serviceInfo.serviceType}")
          try {
            nsdManager?.resolveService(serviceInfo, object : NsdManager.ResolveListener {
              override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { Log.e(TAG, "[NSD] RESOLVE FAILED name=${info.serviceName} code=$errorCode") }
              override fun onServiceResolved(info: NsdServiceInfo) { Log.d(TAG, "[NSD] RESOLVED name=${info.serviceName} host=${info.host} port=${info.port}") }
            })
          } catch (e: Exception) { Log.e(TAG, "[NSD] Resolve exception", e) }
        }
      }
      nsdDiscovery = discovery
      nsdManager?.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
    } catch (e: Exception) { Log.e(TAG, "[NSD] Discovery exception", e) }
  }

  private fun stopNsd() {
    Log.d(TAG, "[NSD] Stopping NSD")
    nsdStopped = true
    nsdDiscovery?.let { try { nsdManager?.stopServiceDiscovery(it) } catch (_: Exception) {} }
    nsdRegistration?.let { try { nsdManager?.unregisterService(it) } catch (_: Exception) {} }
    nsdDiscovery = null; nsdRegistration = null; nsdManager = null
  }

  private fun startCallServer() {
    Log.d(TAG, "[TCP BG] Server startup requested on :$CALL_PORT")
    executor.execute {
      while (!Thread.currentThread().isInterrupted) {
        try {
          val server = ServerSocket(CALL_PORT)
          callServer = server
          Log.d(TAG, "[TCP BG] SERVER LISTENING on :$CALL_PORT")
          while (!Thread.currentThread().isInterrupted) {
            val socket = server.accept()
            Log.d(TAG, "[TCP BG] ACCEPTED connection from ${socket.inetAddress.hostAddress}:${socket.port}")
            executor.execute { handleCall(socket) }
          }
          break
        } catch (e: BindException) {
          callServer = null
          Log.e(TAG, "[TCP BG] BIND FAILED EADDRINUSE - foreground TCP server may still own :$CALL_PORT")
          try { Thread.sleep(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        } catch (e: Exception) {
          callServer = null
          if (!Thread.currentThread().isInterrupted) Log.e(TAG, "[TCP BG] SERVER STOPPED", e)
          break
        }
      }
    }
  }

  private fun handleCall(socket: Socket) {
    Log.d(TAG, "[CALL] handleCall() entered remote=${socket.inetAddress.hostAddress}")
    try {
      val line = BufferedReader(InputStreamReader(socket.getInputStream())).readLine()
      Log.d(TAG, "[CALL] First TCP line=$line")
      if (line == null) { Log.w(TAG, "[CALL] Peer closed before sending a message"); socket.close(); return }
      val message = JSONObject(line)
      val type = message.optString("type")
      Log.d(TAG, "[CALL] Parsed message type=$type")
      if (type != "call_request") { Log.w(TAG, "[CALL] Ignoring non-call_request type=$type"); socket.close(); return }
      pendingSocket?.close()
      pendingSocket = socket
      pendingIp = socket.inetAddress.hostAddress
      pendingName = message.optString("senderName", "iTantra device")
      persistPendingCall(pendingIp ?: "", pendingName ?: "iTantra device")
      Log.d(TAG, "[CALL] INCOMING CALL stored name=$pendingName ip=$pendingIp socketClosed=${socket.isClosed}")
      showIncomingCallNotification(pendingName ?: "iTantra device")
    } catch (e: Exception) {
      Log.e(TAG, "[CALL] Failed to handle incoming call", e)
      try { socket.close() } catch (_: Exception) {}
    }
  }

  private fun showIncomingCallNotification(name: String) {
    Log.d(TAG, "[NOTIFICATION] Creating incoming call notification for name=$name")
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val acceptIntent = Intent(this, DiscoveryService::class.java).apply { action = ACTION_ACCEPT; setPackage(packageName) }
    val rejectIntent = Intent(this, DiscoveryService::class.java).apply { action = ACTION_REJECT; setPackage(packageName) }
    val accept = PendingIntent.getService(this, 1, acceptIntent, flags)
    val reject = PendingIntent.getService(this, 2, rejectIntent, flags)
    val builder = Notification.Builder(this, CALL_CHANNEL_ID)
      .setContentTitle("Incoming iTantra call")
      .setContentText("$name is trying to call you")
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Accept", accept).build())
      .addAction(Notification.Action.Builder(null, "Reject", reject).build())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    getSystemService(NotificationManager::class.java).notify(CALL_NOTIFICATION_ID, builder.build())
    Log.d(TAG, "[NOTIFICATION] POSTED id=$CALL_NOTIFICATION_ID acceptAction=$ACTION_ACCEPT")
  }

  private fun sendCallAccept(ip: String, existingSocket: Socket?): Boolean {
    val response = JSONObject().put("type", "call_accept").put("senderId", deviceId()).put("timestamp", System.currentTimeMillis()).toString()
    if (existingSocket != null && !existingSocket.isClosed && existingSocket.isConnected) {
      try {
        Log.d(TAG, "[ACCEPT] Sending call_accept on original socket")
        PrintWriter(OutputStreamWriter(existingSocket.getOutputStream()), true).println(response)
        Log.d(TAG, "[ACCEPT] call_accept SENT on original socket")
        return true
      } catch (e: Exception) {
        Log.e(TAG, "[ACCEPT] Original socket send failed; falling back to new connection", e)
      }
    } else {
      Log.w(TAG, "[ACCEPT] Original socket unavailable; using fallback connection")
    }
    if (ip.isBlank()) { Log.e(TAG, "[ACCEPT] Fallback ABORT: caller IP is blank"); return false }
    return try {
      Socket().use { ackSocket ->
        Log.d(TAG, "[ACCEPT] Fallback connecting to caller $ip:$CALL_PORT")
        ackSocket.connect(InetSocketAddress(ip, CALL_PORT), 3000)
        PrintWriter(OutputStreamWriter(ackSocket.getOutputStream()), true).println(response)
        Log.d(TAG, "[ACCEPT] call_accept SENT on fallback connection")
      }
      true
    } catch (e: Exception) {
      Log.e(TAG, "[ACCEPT] Fallback call_accept FAILED", e)
      false
    }
  }

  private fun acceptCall() {
    Log.d(TAG, "[ACCEPT] ===== ACCEPT BUTTON RECEIVED =====")
    restorePendingCall()
    val socket = pendingSocket
    val ip = pendingIp ?: ""
    val name = pendingName ?: "iTantra device"
    Log.d(TAG, "[ACCEPT] state before ACK ip=$ip name=$name socketPresent=${socket != null} socketClosed=${socket?.isClosed}")
    if (ip.isBlank()) { Log.e(TAG, "[ACCEPT] ABORT: no pending caller IP"); return }
    val accepted = sendCallAccept(ip, socket)
    if (!accepted) { Log.e(TAG, "[ACCEPT] ABORT: could not deliver call_accept; keeping pending state for retry"); return }
    Log.d(TAG, "[ACCEPT] ACK delivered; now closing temporary background call socket")
    clearPending()
    getSystemService(NotificationManager::class.java).cancel(CALL_NOTIFICATION_ID)
    try { callServer?.close() } catch (e: Exception) { Log.e(TAG, "[ACCEPT] Error closing background call server", e) }
    callServer = null
    clearPersistedPendingCall()
    val encodedName = URLEncoder.encode(name, "UTF-8")
    val uri = "itantra://incoming-call?ip=$ip&name=$encodedName"
    Log.d(TAG, "[ACCEPT] Preparing MainActivity deep link uri=$uri")
    val intent = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = android.net.Uri.parse(uri)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    Log.d(TAG, "[ACCEPT] Launching MainActivity flags=${intent.flags} action=${intent.action} data=${intent.data}")
    try {
      startActivity(intent)
      Log.d(TAG, "[ACCEPT] startActivity(MainActivity) RETURNED")
    } catch (e: Exception) {
      Log.e(TAG, "[ACCEPT] startActivity FAILED", e)
    }
  }

  private fun rejectCall() {
    Log.d(TAG, "[REJECT] ===== REJECT BUTTON RECEIVED =====")
    restorePendingCall()
    val socket = pendingSocket
    val ip = pendingIp ?: ""
    Log.d(TAG, "[REJECT] state ip=$ip socketPresent=${socket != null}")
    if (socket != null && !socket.isClosed) {
      try {
        PrintWriter(OutputStreamWriter(socket.getOutputStream()), true).println(JSONObject().put("type", "call_reject").put("senderId", deviceId()).put("timestamp", System.currentTimeMillis()).toString())
        Log.d(TAG, "[REJECT] call_reject SENT")
      } catch (e: Exception) { Log.e(TAG, "[REJECT] Failed sending rejection", e) }
    }
    clearPending()
    clearPersistedPendingCall()
    getSystemService(NotificationManager::class.java).cancel(CALL_NOTIFICATION_ID)
  }

  private fun clearPending() {
    Log.d(TAG, "[CALL] clearPending() socket=${pendingSocket != null} ip=$pendingIp")
    try { pendingSocket?.close() } catch (_: Exception) {}
    pendingSocket = null; pendingIp = null; pendingName = null
  }

  private fun deviceId(): String = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

  private fun serviceNotification(): Notification = Notification.Builder(this, CHANNEL_ID)
    .setContentTitle("iTantra network ready")
    .setContentText("NSD discovery is running in the background")
    .setSmallIcon(android.R.drawable.ic_dialog_info)
    .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE) }
    .build()

  private fun createChannels() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "iTantra discovery", NotificationManager.IMPORTANCE_LOW))
      manager.createNotificationChannel(NotificationChannel(CALL_CHANNEL_ID, "iTantra calls", NotificationManager.IMPORTANCE_HIGH))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.d(TAG, "[SERVICE] onStartCommand action=${intent?.action} data=${intent?.data} startId=$startId")
    when (intent?.action) {
      ACTION_ACCEPT -> acceptCall()
      ACTION_REJECT -> rejectCall()
      else -> Log.d(TAG, "[SERVICE] Normal service start")
    }
    return START_STICKY
  }

  override fun onDestroy() {
    Log.d(TAG, "[SERVICE] ===== DiscoveryService.onDestroy() =====")
    stopNsd()
    try { callServer?.close() } catch (_: Exception) {}
    callServer = null
    executor.shutdownNow()
    clearPending()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
