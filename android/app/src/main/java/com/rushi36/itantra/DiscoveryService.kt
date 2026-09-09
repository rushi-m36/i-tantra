package com.rushi36.itantra

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class DiscoveryService : Service() {
  companion object {
    const val ACTION_START = "com.rushi36.itantra.START_DISCOVERY"
    const val ACTION_STOP = "com.rushi36.itantra.STOP_DISCOVERY"
    private const val CHANNEL_ID = "itantra_discovery"
    private const val NOTIFICATION_ID = 5556
    private const val DISCOVERY_PORT = 5556
    private const val MAGIC = "ITANTRA_DISCOVER_V1"
    private const val INTERVAL_SECONDS = 8L
  }

  private val executor = Executors.newSingleThreadScheduledExecutor()
  private var socket: DatagramSocket? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    startForeground(NOTIFICATION_ID, notification())
    startDiscovery()
  }

  private fun startDiscovery() {
    executor.scheduleAtFixedRate({
      try {
        if (!hasWifiNetwork()) return@scheduleAtFixedRate
        val localIp = localWifiIp() ?: return@scheduleAtFixedRate
        val message = "$MAGIC|$localIp".toByteArray(Charsets.UTF_8)
        val address = InetAddress.getByName("255.255.255.255")
        DatagramSocket().use { sender ->
          sender.broadcast = true
          sender.send(DatagramPacket(message, message.size, address, DISCOVERY_PORT))
        }
      } catch (_: Exception) {
        // Discovery is best-effort. The next interval retries.
      }
    }, 0, INTERVAL_SECONDS, TimeUnit.SECONDS)
  }

  private fun hasWifiNetwork(): Boolean {
    return try {
      NetworkInterface.getNetworkInterfaces().toList().any { iface ->
        iface.isUp && !iface.isLoopback && iface.name.lowercase().contains("wlan")
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun localWifiIp(): String? {
    return try {
      NetworkInterface.getNetworkInterfaces().toList()
        .flatMap { it.inetAddresses.toList() }
        .firstOrNull { address ->
          !address.isLoopbackAddress && address.hostAddress?.contains('.') == true
        }?.hostAddress
    } catch (_: Exception) {
      null
    }
  }

  private fun notification(): Notification {
    return Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("iTantra network discovery")
      .setContentText("Available while connected to Wi-Fi")
      .setSmallIcon(android.R.drawable.stat_sys_data_wifi)
      .setOngoing(true)
      .build()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "iTantra discovery", NotificationManager.IMPORTANCE_LOW)
      )
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) stopSelf()
    return START_STICKY
  }

  override fun onDestroy() {
    executor.shutdownNow()
    socket?.close()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
