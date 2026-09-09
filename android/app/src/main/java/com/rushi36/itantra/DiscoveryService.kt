package com.rushi36.itantra

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.io.PrintWriter
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class DiscoveryService : Service() {
  companion object {
    private const val CHANNEL_ID = "itantra_discovery"
    private const val CALL_CHANNEL_ID = "itantra_calls"
    private const val NOTIFICATION_ID = 5556
    private const val CALL_NOTIFICATION_ID = 5557
    private const val DISCOVERY_PORT = 5556
    private const val CALL_PORT = 5555
    private const val MAGIC = "ITANTRA_DISCOVER_V1"
    private const val INTERVAL_SECONDS = 8L
    const val ACTION_ACCEPT = "com.rushi36.itantra.ACCEPT_CALL"
    const val ACTION_REJECT = "com.rushi36.itantra.REJECT_CALL"
  }

  private val executor = Executors.newCachedThreadPool()
  private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
  private var discoveryServer: ServerSocket? = null
  private var callServer: ServerSocket? = null
  private var pendingSocket: Socket? = null
  private var pendingIp: String? = null
  private var pendingName: String? = null

  override fun onCreate() {
    super.onCreate()
    createChannels()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        serviceNotification(),
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING,
      )
    } else {
      startForeground(NOTIFICATION_ID, serviceNotification())
    }
    startDiscoveryServer()
    startCallServer()
    scheduler.scheduleAtFixedRate({
      if (!hasWifiNetwork()) stopSelf()
    }, 0, INTERVAL_SECONDS, TimeUnit.SECONDS)
  }

  private fun startDiscoveryServer() {
    executor.execute {
      try {
        discoveryServer = ServerSocket(DISCOVERY_PORT)
        while (!Thread.currentThread().isInterrupted) {
          val socket = discoveryServer?.accept() ?: break
          executor.execute { handleDiscovery(socket) }
        }
      } catch (_: Exception) {
        // The React Native discovery server may own this port while the app is open.
      }
    }
  }

  private fun handleDiscovery(socket: Socket) {
    socket.use {
      try {
        val request = BufferedReader(InputStreamReader(it.getInputStream())).readLine()
        if (request != MAGIC) return
        val response = JSONObject()
          .put("magic", MAGIC)
          .put("id", deviceId())
          .put("name", deviceName())
          .put("port", CALL_PORT)
          .toString()
        PrintWriter(OutputStreamWriter(it.getOutputStream()), true).println(response)
      } catch (_: Exception) {}
    }
  }

  private fun startCallServer() {
    executor.execute {
      try {
        callServer = ServerSocket(CALL_PORT)
        while (!Thread.currentThread().isInterrupted) {
          val socket = callServer?.accept() ?: break
          executor.execute { handleCall(socket) }
        }
      } catch (_: Exception) {
        // The React Native TCP server owns port 5555 while the app is open.
      }
    }
  }

  private fun handleCall(socket: Socket) {
    try {
      val line = BufferedReader(InputStreamReader(socket.getInputStream())).readLine() ?: run {
        socket.close(); return
      }
      val message = JSONObject(line)
      if (message.optString("type") != "call_request") {
        socket.close(); return
      }
      pendingSocket?.close()
      pendingSocket = socket
      pendingIp = socket.inetAddress.hostAddress
      pendingName = message.optString("senderName", "iTantra device")
      showIncomingCallNotification(pendingName ?: "iTantra device")
    } catch (_: Exception) {
      socket.close()
    }
  }

  private fun showIncomingCallNotification(name: String) {
    val accept = Intent(this, DiscoveryService::class.java).setAction(ACTION_ACCEPT)
    val reject = Intent(this, DiscoveryService::class.java).setAction(ACTION_REJECT)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val acceptPending = PendingIntent.getService(this, 1, accept, flags)
    val rejectPending = PendingIntent.getService(this, 2, reject, flags)

    val notification = Notification.Builder(this, CALL_CHANNEL_ID)
      .setContentTitle("Incoming iTantra call")
      .setContentText("$name is trying to call you")
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Accept", acceptPending).build())
      .addAction(Notification.Action.Builder(null, "Reject", rejectPending).build())
      .build()

    getSystemService(NotificationManager::class.java).notify(CALL_NOTIFICATION_ID, notification)
  }

  private fun acceptCall() {
    val socket = pendingSocket ?: return
    try {
      PrintWriter(OutputStreamWriter(socket.getOutputStream()), true).println(
        JSONObject().put("type", "call_accept")
          .put("senderId", deviceId()).put("timestamp", System.currentTimeMillis()).toString()
      )
    } catch (_: Exception) {
      clearPending(); return
    }

    val ip = pendingIp ?: ""
    val name = pendingName ?: "iTantra device"
    clearPending()
    getSystemService(NotificationManager::class.java).cancel(CALL_NOTIFICATION_ID)
    try { callServer?.close() } catch (_: Exception) {}
    callServer = null

    val intent = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      data = android.net.Uri.parse(
        "itantra://incoming-call?ip=$ip&name=${java.net.URLEncoder.encode(name, "UTF-8")}"
      )
    }
    startActivity(intent)
  }

  private fun rejectCall() {
    val socket = pendingSocket ?: return
    try {
      PrintWriter(OutputStreamWriter(socket.getOutputStream()), true).println(
        JSONObject().put("type", "call_reject")
          .put("senderId", deviceId()).put("timestamp", System.currentTimeMillis()).toString()
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

  private fun deviceId(): String =
    Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

  private fun deviceName(): String = Build.MODEL.ifBlank { "Android device" }

  private fun hasWifiNetwork(): Boolean = try {
    NetworkInterface.getNetworkInterfaces().toList().any { iface ->
      iface.isUp && !iface.isLoopback && iface.name.lowercase().contains("wlan")
    }
  } catch (_: Exception) { false }

  private fun serviceNotification(): Notification =
    Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("iTantra network ready")
      .setContentText("Listening for nearby iTantra devices")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .build()

  private fun createChannels() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "iTantra discovery", NotificationManager.IMPORTANCE_LOW)
      )
      manager.createNotificationChannel(
        NotificationChannel(CALL_CHANNEL_ID, "iTantra calls", NotificationManager.IMPORTANCE_HIGH)
      )
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
    scheduler.shutdownNow()
    executor.shutdownNow()
    try { discoveryServer?.close() } catch (_: Exception) {}
    try { callServer?.close() } catch (_: Exception) {}
    clearPending()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
