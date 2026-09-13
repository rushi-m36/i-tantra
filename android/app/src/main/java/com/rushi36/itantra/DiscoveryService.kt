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
    Log.d(TAG, "DiscoveryService created")
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
        override fun onServiceRegistered(info: NsdServiceInfo) {
          Log.d(TAG, "NSD registered: ${info.serviceName}")
        }
        override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
          Log.e(TAG, "NSD registration failed: $errorCode")
        }
        override fun onServiceUnregistered(info: NsdServiceInfo) {
          Log.d(TAG, "NSD unregistered: ${info.serviceName}")
        }
        override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
          Log.e(TAG, "NSD unregistration failed: $errorCode")
        }
      }
      nsdRegistration = registration
      nsdManager?.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration)
    } catch (e: Exception) {
      Log.e(TAG, "NSD registration exception", e)
    }

    try {
      val discovery = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {
          Log.d(TAG, "NSD discovery started")
        }
        override fun onDiscoveryStopped(serviceType: String) {
          Log.d(TAG, "NSD discovery stopped")
        }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
          Log.e(TAG, "NSD discovery start failed: $errorCode")
          try { nsdManager?.stopServiceDiscovery(this) } catch (_: Exception) {}
        }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
          Log.e(TAG, "NSD discovery stop failed: $errorCode")
        }
        override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
          if (nsdStopped || serviceInfo.serviceType != NSD_TYPE || serviceInfo.serviceName == serviceName) return
          Log.d(TAG, "NSD peer found: ${serviceInfo.serviceName}")
          try {
            nsdManager?.resolveService(serviceInfo, object : NsdManager.ResolveListener {
              override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "NSD resolve failed: ${info.serviceName}, $errorCode")
              }
              override fun onServiceResolved(info: NsdServiceInfo) {
                Log.d(TAG, "NSD peer resolved: ${info.serviceName} ${info.host}:${info.port}")
              }
            })
          } catch (e: Exception) {
            Log.e(TAG, "NSD resolve exception", e)
          }
        }
      }
      nsdDiscovery = discovery
      nsdManager?.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
    } catch (e: Exception) {
      Log.e(TAG, "NSD discovery exception", e)
    }
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
      while (!Thread.currentThread().isInterrupted) {
        try {
          val server = ServerSocket(CALL_PORT)
          callServer = server
          Log.d(TAG, "Background TCP call server listening on port $CALL_PORT")
          while (!Thread.currentThread().isInterrupted) {
            val socket = server.accept()
            Log.d(TAG, "Incoming TCP connection from ${socket.inetAddress.hostAddress}")
            executor.execute { handleCall(socket) }
          }
          break
        } catch (e: BindException) {
          callServer = null
          Log.w(TAG, "Port $CALL_PORT is still in use; retrying background call server")
          try {
            Thread.sleep(500)
          } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
          }
        } catch (e: Exception) {
          callServer = null
          if (!Thread.currentThread().isInterrupted) Log.e(TAG, "Background TCP call server stopped", e)
          break
        }
      }
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
      Log.d(TAG, "Incoming call request from ${pendingName} ($pendingIp)")
      showIncomingCallNotification(pendingName ?: "iTantra device")
    } catch (e: Exception) {
      Log.e(TAG, "Failed to handle incoming call", e)
      try { socket.close() } catch (_: Exception) {}
    }
  }

  private fun showIncomingCallNotification(name: String) {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val accept = PendingIntent.getService(this, 1, Intent(this, DiscoveryService::class.java).setAction(ACTION_ACCEPT), flags)
    val reject = PendingIntent.getService(this, 2, Intent(this, DiscoveryService::class.java).setAction(ACTION_REJECT), flags)
    val builder = Notification.Builder(this, CALL_CHANNEL_ID)
      .setContentTitle("Incoming iTantra call")
      .setContentText("$name is trying to call you")
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Accept", accept).build())
      .addAction(Notification.Action.Builder(null, "Reject", reject).build())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    getSystemService(NotificationManager::class.java).notify(CALL_NOTIFICATION_ID, builder.build())
    Log.d(TAG, "Incoming call notification posted for $name")
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

  private fun serviceNotification(): Notification {
    val builder = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("iTantra network ready")
      .setContentText("NSD discovery is running in the background")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder.build()
  }

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
    Log.d(TAG, "DiscoveryService destroyed")
    stopNsd()
    try { callServer?.close() } catch (_: Exception) {}
    callServer = null
    executor.shutdownNow()
    clearPending()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
