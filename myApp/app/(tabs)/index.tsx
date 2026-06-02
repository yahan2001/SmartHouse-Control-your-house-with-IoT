import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Animated,
  Dimensions,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import axios, { isAxiosError } from "axios";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import * as ExpoDevice from "expo-device";
import * as Notifications from "expo-notifications";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const MAX_GAS_VALUE = 2500;
const SCREEN = Dimensions.get("window");
const DA_NANG_WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=16.0678&longitude=108.2208&current=temperature_2m&timezone=Asia%2FHo_Chi_Minh";

type Device = {
  id: number;
  name: string;
  type: string;
  room: string;
  status: boolean;
  pin: number;
};

type DeviceAction = "on" | "off";

const ROOM_FILTERS = [
  {
    label: "Tất cả",
    aliases: []
  },
  {
    label: "Phòng khách",
    aliases: ["phong khach", "living room", "living"]
  },
  {
    label: "Phòng ngủ",
    aliases: ["phong ngu", "bedroom", "bed room"]
  },
  {
    label: "Nhà bếp",
    aliases: ["nha bep", "kitchen"]
  },
  {
    label: "Phòng tắm",
    aliases: ["phong tam", "bathroom", "bath room"]
  },
  {
    label: "Cửa vào",
    aliases: ["cua vao", "entrance", "door"]
  },
  {
    label: "Ban công",
    aliases: ["ban cong", "balcony"]
  },
];

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .trim();

export default function HomeScreen() {
  // Configurable API state
  const [serverIp, setServerIp] = useState("192.168.2.7:8000");
  const [tempIp, setTempIp] = useState("192.168.2.7:8000");
  const [isIpModalOpen, setIsIpModalOpen] = useState(false);

  const [devices, setDevices] = useState<Device[]>([]);
  const [gas, setGas] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [humidity, setHumidity] = useState(0);
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [daNangTemp, setDaNangTemp] = useState<number | null>(null);

  // Filter room state
  const [selectedRoom, setSelectedRoom] = useState("Tất cả");

  // AI Assistant states
  const [assistantText, setAssistantText] = useState(
    "Chào bạn! Tôi là trợ lý AI Smart Home. Nhập hoặc chạm vào câu lệnh bên dưới để điều khiển nhé."
  );
  const [manualCommand, setManualCommand] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const gasPulseAnim = useRef(new Animated.Value(1)).current;
  const voicePressRecordingRef = useRef(false);

  // Compute actual API url
  const getApiUrl = useCallback(() => {
    const formattedIp = serverIp.trim();
    if (!formattedIp.startsWith("http")) {
      return `http://${formattedIp}`.replace(/\/+$/, "");
    }
    return formattedIp.replace(/\/+$/, "");
  }, [serverIp]);

  const formattedVietnamDate = currentTime
    .toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "Asia/Ho_Chi_Minh",
    })
    .toUpperCase();

  const formattedVietnamTime = currentTime.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  const fetchDaNangWeather = useCallback(async () => {
    try {
      const response = await axios.get(DA_NANG_WEATHER_URL);
      const nextTemp = response.data?.current?.temperature_2m;

      if (typeof nextTemp === "number") {
        setDaNangTemp(Math.round(nextTemp));
      }
    } catch (error) {
      console.log("Error fetching Da Nang weather:", error);
    }
  }, []);

  // Pulsing animation for AI Button
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();

      if (!permission.granted) {
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    })();
  }, []);

  useEffect(() => {
    fetchDaNangWeather();

    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    const weatherInterval = setInterval(() => {
      fetchDaNangWeather();
    }, 10 * 60 * 1000);

    return () => {
      clearInterval(clockInterval);
      clearInterval(weatherInterval);
    };
  }, [fetchDaNangWeather]);

  // Pulsing warning for Dangerous Gas
  useEffect(() => {
    if (gas > MAX_GAS_VALUE) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(gasPulseAnim, {
            toValue: 0.4,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(gasPulseAnim, {
            toValue: 1.0,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      gasPulseAnim.setValue(1);
    }
  }, [gas, gasPulseAnim]);

  /*
      LOAD DEVICES
  */
  const fetchDevices = useCallback(async (showSilently = true) => {
    if (!showSilently) setLoading(true);
    try {
      const API = getApiUrl();
      const response = await axios.get(`${API}/devices/`);
      setDevices(response.data);
      setConnectionError("");
    } catch (error) {
      console.log("Error fetching devices:", error);
      setConnectionError(`Khong ket noi duoc backend:}`);
    } finally {
      if (!showSilently) setLoading(false);
    }
  }, [getApiUrl]);

  /*
      LOAD SENSOR DATA
  */
  const fetchSensorData = useCallback(async () => {
    try {
      const API = getApiUrl();
      const response = await axios.get(`${API}/sensor-data/latest`);
      const data = response.data || {};
      setGas(data.gas || 0);
      setTemperature(data.temperature || 0);
      setHumidity(data.humidity || 0);

      // Gas warning
      if (data.gas > MAX_GAS_VALUE) {
        // Alert trigger only occasionally or handle locally in UI elegantly
      }
    } catch (error) {
      console.log("Error fetching sensors:", error);
    }
  }, [getApiUrl]);

  /*
      CONTROL DEVICE
  */
  const setDeviceStatus = async (device: Device, action: DeviceAction) => {
    try {
      const API = getApiUrl();
      await axios.post(`${API}/devices/${device.id}`, { action });
      await fetchDevices(true);
      return true;
    } catch (error) {
      console.log("Error controlling device:", error);
      Alert.alert("Lỗi", "Không thể kết nối với thiết bị ESP32.");
      return false;
    }
  };

  const toggleDevice = async (device: Device) => {
    const action = device.status ? "off" : "on";
    await setDeviceStatus(device, action);
  };

  /*
      AI ASSISTANT COMMANDS
  */
  const handleAssistantCommand = async (command: string) => {
    if (!command.trim()) return;
    try {
      setIsAiLoading(true);
      setAssistantText("Đang xử lý yêu cầu của bạn...");
      const API = getApiUrl();
      const response = await axios.post(`${API}/assistant/voice-command`, {
        command,
      });
      setAssistantText(response.data.message);
      await fetchDevices(true);
    } catch (error) {
      console.log("Error AI:", error);
      if (isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === "string") {
          setAssistantText(detail);
          return;
        }
      }
      setAssistantText("Trợ lý AI bận hoặc máy chủ không phản hồi.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const sendVoiceAudio = async (uri: string) => {
    try {
      setIsAiLoading(true);
      setAssistantText("Dang gui audio len backend Gemini...");

      const API = getApiUrl();
      const formData = new FormData();

      formData.append("audio", {
        uri,
        name: "voice-command.m4a",
        type: "audio/m4a",
      } as unknown as Blob);

      const response = await axios.post(
        `${API}/assistant/voice-audio`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      setAssistantText(response.data.message);
      await fetchDevices(true);
    } catch (error) {
      console.log("Error voice AI:", error);
      if (isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === "string") {
          setAssistantText(detail);
          return;
        }
      }
      setAssistantText("Backend khong xu ly duoc audio nay.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const startVoiceRecording = async () => {
    if (isAiLoading || recorderState.isRecording || voicePressRecordingRef.current) {
      return;
    }

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();

      if (!permission.granted) {
        Alert.alert("Micro", "Ung dung chua co quyen su dung micro.");
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      voicePressRecordingRef.current = true;
      setAssistantText("Dang nghe lenh cua ban...");
    } catch (error) {
      voicePressRecordingRef.current = false;
      console.log("Error start recording:", error);
      setAssistantText("Khong bat duoc micro.");
    }
  };

  const stopVoiceRecording = async () => {
    if (!voicePressRecordingRef.current) {
      return;
    }

    voicePressRecordingRef.current = false;

    try {
      await audioRecorder.stop();

      if (!audioRecorder.uri) {
        setAssistantText("Khong tim thay file ghi am.");
        return;
      }

      await sendVoiceAudio(audioRecorder.uri);
    } catch (error) {
      voicePressRecordingRef.current = false;
      console.log("Error stop recording:", error);
      setAssistantText("Khong dung duoc ghi am.");
    }
  };

  const registerForPushNotifications = useCallback(async () => {
    try {
      if (!ExpoDevice.isDevice) {
        setNotificationStatus("Can iPhone that de nhan canh bao push.");
        return;
      }

      const currentPermission =
        await Notifications.getPermissionsAsync();

      let finalStatus = currentPermission.status;

      if (currentPermission.status !== "granted") {
        const requestedPermission =
          await Notifications.requestPermissionsAsync();
        finalStatus = requestedPermission.status;
      }

      if (finalStatus !== "granted") {
        setNotificationStatus("Chua cap quyen thong bao.");
        return;
      }

      const projectId =
        Constants.easConfig?.projectId ||
        Constants.expoConfig?.extra?.eas?.projectId;

      if (!projectId) {
        setNotificationStatus("Thieu EAS projectId de lay push token.");
        return;
      }

      const pushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      const API = getApiUrl();

      await axios.post(`${API}/notifications/register`, {
        token: pushToken.data,
        platform: "ios",
      });

    } catch (error) {
      console.log("Error registering notifications:", error);
      
    }
  }, [getApiUrl]);

  // Setup Background Polling
  useEffect(() => {
    fetchDevices(false);
    fetchSensorData();
    registerForPushNotifications();

    const interval = setInterval(() => {
      fetchSensorData();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchDevices, fetchSensorData, registerForPushNotifications]);

  // Filter devices list based on selected room
  const selectedRoomFilter = ROOM_FILTERS.find(
    (room) => room.label === selectedRoom
  );

  const filteredDevices =
    !selectedRoomFilter || selectedRoomFilter.label === "Tất cả"
      ? devices
      : devices.filter((device) => {
          const room = normalizeText(device.room || "");
          const name = normalizeText(device.name || "");
          const type = normalizeText(device.type || "");
          const deviceText = `${room} ${name} ${type}`;

          return selectedRoomFilter.aliases.some((alias) =>
            deviceText.includes(alias)
          );
        });

  // Render device icon dynamically based on name/type
  const getDeviceIconAndColor = (device: Device) => {
    const name = device.name.toLowerCase();
    const type = device.type.toLowerCase();
    const isOn = device.status;

    if (name.includes("đèn") || type.includes("light")) {
      return {
        icon: "lightbulb-outline" as const,
        activeIcon: "lightbulb" as const,
        color: isOn ? "#FBBF24" : "#9CA3AF",
        bgGlow: isOn ? "rgba(251, 191, 36, 0.12)" : "transparent",
        accent: "#FBBF24",
      };
    } else if (name.includes("quạt") || type.includes("fan")) {
      return {
        icon: "fan-off" as const,
        activeIcon: "fan" as const,
        color: isOn ? "#22D3EE" : "#9CA3AF",
        bgGlow: isOn ? "rgba(34, 211, 238, 0.12)" : "transparent",
        accent: "#22D3EE",
      };
    } else if (name.includes("điều hòa") || name.includes("lạnh") || type.includes("ac")) {
      return {
        icon: "air-conditioner" as const,
        activeIcon: "air-conditioner" as const,
        color: isOn ? "#3B82F6" : "#9CA3AF",
        bgGlow: isOn ? "rgba(59, 130, 246, 0.12)" : "transparent",
        accent: "#3B82F6",
      };
    } else if (name.includes("tivi") || name.includes("tv") || type.includes("tv")) {
      return {
        icon: "television" as const,
        activeIcon: "television-play" as const,
        color: isOn ? "#A78BFA" : "#9CA3AF",
        bgGlow: isOn ? "rgba(167, 139, 250, 0.12)" : "transparent",
        accent: "#A78BFA",
      };
    } else {
      return {
        icon: "power" as const,
        activeIcon: "power" as const,
        color: isOn ? "#10B981" : "#9CA3AF",
        bgGlow: isOn ? "rgba(16, 185, 129, 0.12)" : "transparent",
        accent: "#10B981",
      };
    }
  };

  const quickPrompts = [
    "Bật đèn phòng khách",
    "Tắt toàn bộ đèn",
    "Bật quạt phòng ngủ",
    "Nhiệt độ hiện tại",
    "Bật tivi phòng khách",
  ];

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* HEADER SECTION */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Smart House</Text>

          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => {
              setTempIp(serverIp);
              setIsIpModalOpen(true);
            }}
          >
            <Ionicons name="wifi" size={20} color="#3B82F6" />
            <Text style={styles.settingsBtnText}>Server IP</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.topStatusCard}>
          <View style={styles.realtimeRow}>
            <View>
              <Text style={styles.dateText}>{formattedVietnamDate}</Text>
              <Text style={styles.timeText}>Việt Nam, {formattedVietnamTime}</Text>
            </View>

            <View style={styles.weatherPill}>
              <Ionicons name="sunny-outline" size={18} color="#F97316" />
              <Text style={styles.weatherText}>
                {daNangTemp === null ? "--" : daNangTemp}°C
              </Text>
            </View>
          </View>
        </View>

        {!!connectionError && (
          <View style={styles.connectionBanner}>
            <Ionicons name="warning-outline" size={16} color="#1D4ED8" />
            <Text style={styles.connectionBannerText}>
              {connectionError}
            </Text>
          </View>
        )}

        {!!notificationStatus && (
          <View style={styles.notificationBanner}>
            <Ionicons name="notifications-outline" size={16} color="#1D4ED8" />
            <Text style={styles.connectionBannerText}>
              {notificationStatus}
            </Text>
          </View>
        )}

        {/* IP CONFIGURATION MODAL */}
        <Modal
          visible={isIpModalOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setIsIpModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Cấu hình Server IP</Text>
              <Text style={styles.modalDesc}>Nhập địa chỉ IP & Port của Backend FastAPI hoạt động trong mạng LAN.</Text>
              <TextInput
                value={tempIp}
                onChangeText={setTempIp}
                style={styles.modalInput}
                placeholder="Ví dụ: 192.168.1.100:8000"
                placeholderTextColor="#64748B"
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setIsIpModalOpen(false)}
                >
                  <Text style={styles.modalBtnTextCancel}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnSave]}
                  onPress={() => {
                    setConnectionError("");
                    setServerIp(tempIp.trim());
                    setIsIpModalOpen(false);
                  }}
                >
                  <Text style={styles.modalBtnTextSave}>Lưu kết nối</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ENVIROMENT SENSORS WIDGET */}
        <Text style={styles.sectionTitle}>Chỉ số môi trường</Text>
        <View style={styles.sensorsRow}>
          {/* Temperature card */}
          <View style={[styles.sensorTile, styles.tempTile]}>
            <View style={styles.sensorIconRow}>
              <MaterialCommunityIcons name="thermometer-high" size={24} color="#F97316" />
              <Text style={styles.sensorStatusText}>Mát mẻ</Text>
            </View>
            <Text style={styles.sensorValue}>{temperature}°C</Text>
            <Text style={styles.sensorLabel}>Nhiệt độ</Text>
          </View>

          {/* Humidity card */}
          <View style={[styles.sensorTile, styles.humidityTile]}>
            <View style={styles.sensorIconRow}>
              <MaterialCommunityIcons name="water-percent" size={24} color="#3B82F6" />
              <Text style={styles.sensorStatusText}>Lý tưởng</Text>
            </View>
            <Text style={styles.sensorValue}>{humidity}%</Text>
            <Text style={styles.sensorLabel}>Độ ẩm</Text>
          </View>

          {/* Gas card */}
          <Animated.View
            style={[
              styles.sensorTile,
              gas > MAX_GAS_VALUE ? styles.gasTileDanger : styles.gasTileSafe,
              { opacity: gasPulseAnim },
            ]}
          >
            <View style={styles.sensorIconRow}>
              <MaterialCommunityIcons
                name={gas > MAX_GAS_VALUE ? "alert-circle-outline" : "shield-check-outline"}
                size={24}
                color={gas > MAX_GAS_VALUE ? "#EF4444" : "#10B981"}
              />
              <Text
                style={[
                  styles.sensorStatusText,
                  { color: gas > MAX_GAS_VALUE ? "#EF4444" : "#10B981", fontWeight: "bold" },
                ]}
              >
                {gas > MAX_GAS_VALUE ? "Rò rỉ!" : "An toàn"}
              </Text>
            </View>
            <Text style={[styles.sensorValue, gas > MAX_GAS_VALUE && { color: "#EF4444" }]}>{gas}</Text>
            <Text style={styles.sensorLabel}>Khí Gas</Text>
          </Animated.View>
        </View>

        {/* ROOM FILTER CHIPS */}
        <View style={styles.roomFilterWrapper}>
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomChipsScroll}>
            {ROOM_FILTERS.map((room) => {
              const isActive = selectedRoom === room.label;
              return (
                <TouchableOpacity
                  key={room.label}
                  style={[styles.roomChip, isActive && styles.roomChipActive]}
                  onPress={() => setSelectedRoom(room.label)}
                >
                  <Text style={[styles.roomChipText, isActive && styles.roomChipTextActive]}>{room.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* DEVICES LIST OVERVIEW */}
        <View style={styles.devicesHeader}>
          <Text style={styles.sectionTitle}>Danh sách thiết bị</Text>
          <Text style={styles.devicesCount}>
            {filteredDevices.filter((d) => d.status).length}/{filteredDevices.length} BẬT
          </Text>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#3B82F6" />
          </View>
        ) : filteredDevices.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="home-lightning-bolt" size={48} color="#475569" />
            <Text style={styles.emptyText}>Không tìm thấy thiết bị nào ở khu vực này</Text>
          </View>
        ) : (
          <View style={styles.devicesGrid}>
            {filteredDevices.map((device) => {
              const spec = getDeviceIconAndColor(device);
              const isOn = device.status;

              return (
                <TouchableOpacity
                  key={device.id}
                  style={[
                    styles.deviceTile,
                    isOn && { borderColor: spec.accent, shadowColor: spec.accent },
                  ]}
                  onPress={() => toggleDevice(device)}
                  activeOpacity={0.8}
                >
                  {/* Glowing LED status dot */}
                  <View style={[styles.tileLed, isOn ? { backgroundColor: spec.accent } : styles.tileLedOff]} />

                  {/* Icon Block */}
                  <View style={[styles.tileIconContainer, { backgroundColor: spec.bgGlow }]}>
                    <MaterialCommunityIcons
                      name={isOn ? spec.activeIcon : spec.icon}
                      size={28}
                      color={spec.color}
                    />
                  </View>

                  {/* Device meta texts */}
                  <Text style={styles.tileDeviceName} numberOfLines={1}>
                    {device.name}
                  </Text>
                  <Text style={styles.tileDeviceRoom}>{device.room}</Text>

                  {/* Quick Toggle pill */}
                  <View style={styles.tileFooter}>
                    <Text style={[styles.tileStatusText, isOn ? { color: spec.accent } : styles.tileStatusOffText]}>
                      {isOn ? "ĐANG BẬT" : "ĐANG TẮT"}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* FLOAT AI ASSISTANT ORB BUTTON */}
      <View style={styles.floatingContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.floatingOrbWrapper,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <TouchableOpacity
            style={styles.chatAvatar}
            onPress={() => setChatOpen((prev) => !prev)}
            activeOpacity={0.9}
          >
            <Ionicons name="home" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* DETAILED GLASSMORPHIC AI ASSISTANT CHAT SCREEN */}
      {chatOpen && (
        <KeyboardAvoidingView
          style={styles.chatPanelOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
        >
          <View style={styles.chatPanel}>
            {/* Header */}
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderInfo}>
                <View style={styles.chatHeaderOrb} />
                <Text style={styles.chatTitle}>Trợ lý AI Smart Home</Text>
              </View>
              <TouchableOpacity onPress={() => setChatOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Chat message content bubble */}
            <ScrollView style={styles.chatMessages} showsVerticalScrollIndicator={false}>
              <View style={styles.assistantBubble}>
                <Ionicons name="hardware-chip-outline" size={18} color="#3B82F6" style={{ marginRight: 6 }} />
                <Text style={styles.assistantMessage}>{assistantText}</Text>
              </View>
              {isAiLoading && (
                <View style={styles.chatLoadingRow}>
                  <ActivityIndicator size="small" color="#3B82F6" />
                  <Text style={styles.chatLoadingText}>Gemini đang phân tích câu lệnh...</Text>
                </View>
              )}
            </ScrollView>

            {/* Suggestions Chips list */}
            <View style={styles.suggestionsWrapper}>
              <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionChipsScroll}>
                {quickPrompts.map((prompt) => (
                  <TouchableOpacity
                    key={prompt}
                    style={styles.suggestionChip}
                    onPress={() => {
                      setManualCommand(prompt);
                      handleAssistantCommand(prompt);
                    }}
                  >
                    <Text style={styles.suggestionText}>{prompt}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Interactive Inputs block */}
            <View style={styles.chatInputRow}>
              <TouchableOpacity
                style={[
                  styles.micButton,
                  recorderState.isRecording && styles.micButtonRecording,
                ]}
                disabled={isAiLoading}
                onPressIn={startVoiceRecording}
                onPressOut={stopVoiceRecording}
              >
                <Ionicons
                  name={recorderState.isRecording ? "stop" : "mic"}
                  size={18}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              <TextInput
                value={manualCommand}
                onChangeText={setManualCommand}
                placeholder="Bật quạt, bật đèn phòng ngủ..."
                placeholderTextColor="#64748B"
                style={styles.commandInput}
                editable={!recorderState.isRecording}
                onSubmitEditing={() => {
                  if (manualCommand.trim()) {
                    handleAssistantCommand(manualCommand.trim());
                    setManualCommand("");
                  }
                }}
              />
              <TouchableOpacity
                style={styles.sendButton}
                disabled={isAiLoading || recorderState.isRecording}
                onPress={() => {
                  if (manualCommand.trim()) {
                    handleAssistantCommand(manualCommand.trim());
                    setManualCommand("");
                  }
                }}
              >
                <Ionicons name="send" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#F4F9FF",
    flex: 1,
  },
  container: {
    flex: 1,
    paddingTop: 50,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  topStatusCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E8F7",
    borderRadius: 18,
    borderTopColor: "#2563EB",
    borderTopWidth: 4,
    borderWidth: 1,
    marginBottom: 18,
    padding: 14,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  realtimeRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dateText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  timeText: {
    color: "#0F3A63",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
  },
  weatherPill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  weatherText: {
    color: "#B45309",
    fontSize: 13,
    fontWeight: "800",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0F3A63",
    letterSpacing: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusDotSafe: {
    backgroundColor: "#10B981", // glowing active green
    shadowColor: "#10B981",
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  statusDotDanger: {
    backgroundColor: "#EF4444", // blinking danger red
    shadowColor: "#EF4444",
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5C7A99",
    letterSpacing: 1,
  },
  settingsButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#D9E8F7",
  },
  settingsBtnText: {
    color: "#0F3A63",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
  connectionBanner: {
    alignItems: "center",
    backgroundColor: "#DBEAFE",
    borderColor: "#BFDBFE",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  connectionBannerText: {
    color: "#1E3A8A",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  notificationBanner: {
    alignItems: "center",
    backgroundColor: "#EAF4FF",
    borderColor: "#BFDBFE",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F3A63",
    marginTop: 8,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  sensorsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sensorTile: {
    width: "31%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E1EEF9",
    borderRadius: 16,
    padding: 12,
    justifyContent: "space-between",
  },
  tempTile: {
    borderColor: "rgba(249, 115, 22, 0.15)",
  },
  humidityTile: {
    borderColor: "rgba(59, 130, 246, 0.15)",
  },
  gasTileSafe: {
    borderColor: "rgba(16, 185, 129, 0.15)",
  },
  gasTileDanger: {
    borderColor: "rgba(239, 68, 68, 0.5)",
    backgroundColor: "rgba(220, 38, 38, 0.15)",
  },
  sensorIconRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sensorStatusText: {
    fontSize: 10,
    color: "#5C7A99",
    fontWeight: "600",
  },
  sensorValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0F3A63",
    marginTop: 10,
  },
  sensorLabel: {
    fontSize: 11,
    color: "#5C7A99",
    marginTop: 2,
  },
  roomFilterWrapper: {
    marginBottom: 16,
  },
  roomChipsScroll: {
    gap: 8,
    paddingRight: 10,
  },
  roomChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E8F7",
  },
  roomChipActive: {
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
  },
  roomChipText: {
    color: "#5C7A99",
    fontSize: 13,
    fontWeight: "600",
  },
  roomChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  devicesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  devicesCount: {
    fontSize: 11,
    fontWeight: "800",
    color: "#3B82F6",
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  devicesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  deviceTile: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E1EEF9",
    borderRadius: 20,
    padding: 16,
    position: "relative",
    // Premium soft card shadows
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  tileLed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: "absolute",
    top: 16,
    right: 16,
  },
  tileLedOff: {
    backgroundColor: "#B7C7D8",
  },
  tileIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    backgroundColor: "#EFF6FF",
  },
  tileDeviceName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F3A63",
    marginBottom: 2,
  },
  tileDeviceRoom: {
    fontSize: 11,
    color: "#5C7A99",
    marginBottom: 12,
  },
  tileFooter: {
    borderTopWidth: 1,
    borderColor: "#EAF2FA",
    paddingTop: 8,
    alignItems: "flex-start",
  },
  tileStatusText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  tileStatusOffText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#7B93AA",
    letterSpacing: 0.5,
  },
  centered: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E1EEF9",
    gap: 8,
  },
  emptyText: {
    color: "#5C7A99",
    fontSize: 13,
    fontWeight: "500",
  },
  floatingContainer: {
    position: "absolute",
    bottom: 30,
    right: 20,
    left: 20,
    alignItems: "flex-end",
    zIndex: 10,
  },
  floatingOrbWrapper: {
    borderRadius: 30,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  chatAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  chatPanelOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 58, 99, 0.18)",
    zIndex: 100,
    justifyContent: "flex-end",
  },
  chatPanel: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: "#D9E8F7",
    padding: 20,
    maxHeight: SCREEN.height * 0.7,
    paddingBottom: 30,
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#EAF2FA",
    paddingBottom: 12,
  },
  chatHeaderInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  chatHeaderOrb: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#3B82F6",
    marginRight: 10,
    shadowColor: "#3B82F6",
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F3A63",
  },
  closeButton: {
    backgroundColor: "#EFF6FF",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  chatMessages: {
    marginBottom: 12,
    maxHeight: 200,
  },
  assistantBubble: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#EFF6FF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#D9E8F7",
  },
  assistantMessage: {
    color: "#0F3A63",
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
    fontWeight: "500",
  },
  chatLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingHorizontal: 8,
    gap: 8,
  },
  chatLoadingText: {
    color: "#5C7A99",
    fontSize: 12,
    fontWeight: "600",
  },
  suggestionsWrapper: {
    marginBottom: 16,
  },
  suggestionChipsScroll: {
    gap: 6,
    paddingVertical: 4,
  },
  suggestionChip: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9E8F7",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  suggestionText: {
    color: "#0F3A63",
    fontSize: 12,
    fontWeight: "600",
  },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  commandInput: {
    flex: 1,
    backgroundColor: "#F8FBFF",
    borderColor: "#D9E8F7",
    borderWidth: 1,
    borderRadius: 16,
    color: "#0F3A63",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: "#3B82F6",
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  micButton: {
    backgroundColor: "rgba(59, 130, 246, 0.25)",
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.45)",
  },
  micButtonRecording: {
    backgroundColor: "#EF4444",
    borderColor: "#FCA5A5",
  },
  // IP Dialog Styling
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 58, 99, 0.22)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#D9E8F7",
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F3A63",
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 12,
    color: "#5C7A99",
    lineHeight: 18,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: "#F8FBFF",
    borderColor: "#D9E8F7",
    borderWidth: 1,
    borderRadius: 12,
    color: "#0F3A63",
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  modalBtnCancel: {
    backgroundColor: "transparent",
  },
  modalBtnSave: {
    backgroundColor: "#3B82F6",
  },
  modalBtnTextCancel: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "700",
  },
  modalBtnTextSave: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
