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
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.Socket
import java.net.URLEncoder
import java.util.concurrent.Executors
import org.json.JSONObject

class DiscoveryService : Service() {
  companion object {
    private const val CHANNEL_ID = "itantra_discovery"
    private const val CALL_CHANNEL_ID = "itantra_calls"
    private const val NOTIFICATION_ID = 5556
    private const val CALL_NOTIFICATION_ID = 5557
    private const val CALL_PORT = 5555
    private const val NSD_TYPE = "_itantra._tcp."
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
    createChannels()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, serviceNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(NOTIFICATION_ID, serviceNotification())
    }
    startNsd()
    startCallServer()
  }

  private fun startNsd() {
    nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
    nsdStopped = false
    val serviceName = "iTantra-${deviceId().takeLast(8)}"

    try {
      val info = NsdServiceInfo().apply {
        this.serviceName = serviceName
        serviceType = NSD_TYPE
        port = CALL_PORT
      }
      val registration = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {}
        override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
      }
      nsdRegistration = registration
      nsdManager?.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration)
    } catch (_: Exception) {}

    try {
      val discovery = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
          try { nsdManager?.stopServiceDiscovery(this) } catch (_: Exception) {}
        }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
          if (nsdStopped || serviceInfo.serviceType != NSD_TYPE || serviceInfo.serviceName == serviceName) return
          try {
            nsdManager?.resolveService(serviceInfo, object : NsdManager.ResolveListener {
              override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
              override fun onServiceResolved(info: NsdServiceInfo) {}
            })
          } catch (_: Exception) {}
        }
      }
      nsdDiscovery = discovery
      nsdManager?.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
    } catch (_: Exception) {}
  }

  private fun stopNsd() {
    nsdStopped = true
    nsdDiscovery?.let { try { nsdManager?.stopServiceDiscovery(it) } catch (_: Exception) {} }
    nsdRegistration?.let { try { nsdManager?.unregisterService(it) } catch (_: Exception) {} }
    nsdDiscovery = null
    nsdRegistration = null
    nsdManager = null
  }

  private fun startCallServer() {
    executor.execute {
      try {
        callServer = ServerSocket(CALL_PORT)
        while (!Thread.currentThread().isInterrupted) {
          val socket = callServer?.accept() ?: break
          executor.execute { handleCall(socket) }
        }
      } catch (_: Exception) {}
    }
  }

  private fun handleCall(socket: Socket) {
    try {
      val line = BufferedReader(InputStreamReader(socket.getInputStream())).readLine() ?: run { socket.close(); return }
      val message = JSONObject(line)
      if (message.optString("type") != "call_request") { socket.close(); return }
      pendingSocket?.close()
      pendingSocket = socket
      pendingIp = socket.inetAddress.hostAddress
      pendingName = message.optString("senderName", "iTantra device")
      showIncomingCallNotification(pendingName ?: "iTantra device")
    } catch (_: Exception) { try { socket.close() } catch (_: Exception) {} }
  }

  private fun showIncomingCallNotification(name: String) {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val accept = PendingIntent.getService(this, 1, Intent(this, DiscoveryService::class.java).setAction(ACTION_ACCEPT), flags)
    val reject = PendingIntent.getService(this, 2, Intent(this, DiscoveryService::class.java).setAction(ACTION_REJECT), flags)
    val notification = Notification.Builder(this, CALL_CHANNEL_ID)
      .setContentTitle("Incoming iTantra call")
      .setContentText("$name is trying to call you")
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Accept", accept).build())
      .addAction(Notification.Action.Builder(null, "Reject", reject).build())
      .build()
    getSystemService(NotificationManager::class.java).notify(CALL_NOTIFICATION_ID, notification)
  }

  private fun acceptCall() {
    val socket = pendingSocket ?: return
    try {
      PrintWriter(OutputStreamWriter(socket.getOutputStream()), true).println(
        JSONObject().put("type", "call_accept").put("senderId", deviceId()).put("timestamp", System.currentTimeMillis()).toString()
      )
    } catch (_: Exception) { clearPending(); return }
    val ip = pendingIp ?: ""
    val name = pendingName ?: "iTantra device"
    clearPending()
    getSystemService(NotificationManager::class.java).cancel(CALL_NOTIFICATION_ID)
    try { callServer?.close() } catch (_: Exception) {}
    callServer = null
    val intent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      data = android.net.Uri.parse("itantra://incoming-call?ip=$ip&name=${URLEncoder.encode(name, "UTF-8")}")
    }
    startActivity(intent)
  }

  private fun rejectCall() {
    val socket = pendingSocket ?: return
    try {
      PrintWriter(OutputStreamWriter(socket.getOutputStream()), true).println(
        JSONObject().put("type", "call_reject").put("senderId", deviceId()).put("timestamp", System.currentTimeMillis()).toString()
      )
    } catch (_: Exception) {}
    clearPending()
    getSystemService(NotificationManager::class.java).cancel(CALL_NOTIFICATION_ID)
  }

  private fun clearPending() {
    try { pendingSocket?.close() } catch (_: Exception) {}
    pendingSocket = null
    pendingIp = null
    pendingName = null
  }

  private fun deviceId(): String = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

  private fun serviceNotification(): Notification = Notification.Builder(this, CHANNEL_ID)
    .setContentTitle("iTantra network ready")
    .setContentText("NSD discovery is running in the background")
    .setSmallIcon(android.R.drawable.ic_dialog_info)
    .build()

  private fun createChannels() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "iTantra discovery", NotificationManager.IMPORTANCE_LOW))
      manager.createNotificationChannel(NotificationChannel(CALL_CHANNEL_ID, "iTantra calls", NotificationManager.IMPORTANCE_HIGH))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_ACCEPT -> acceptCall()
      ACTION_REJECT -> rejectCall()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    stopNsd()
    executor.shutdownNow()
    try { callServer?.close() } catch (_: Exception) {}
    clearPending()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
