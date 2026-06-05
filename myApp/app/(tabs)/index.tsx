import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import axios, { isAxiosError } from "axios";
import Constants from "expo-constants";
import * as DeviceInfo from "expo-device";
import * as Notifications from "expo-notifications";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

const SCREEN = Dimensions.get("window");
const MAX_GAS_VALUE = 1500;
const SENSOR_REFRESH_INTERVAL_MS = 5000;
const DEVICE_REFRESH_INTERVAL_MS = 15000;
const POLLING_REQUEST_TIMEOUT_MS = 2500;
const DEVICE_CONTROL_TIMEOUT_MS = 6000;
const DARK_LIGHT_VALUE = 3000;
const BRIGHT_LIGHT_VALUE = 2900;
const FALLBACK_BACKEND_IP = "192.168.2.7:8000";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Device = {
  id: number;
  name: string;
  type: string;
  room: string;
  status: boolean;
  pin: number;
};

type DeviceAction = "on" | "off";
type AppTab = "home" | "rooms" | "automations" | "profile";
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const ROOM_FILTERS = [
  { label: "Tất cả", aliases: [] },
  { label: "Phòng khách", aliases: ["phong khach", "living room", "living"] },
  { label: "Phòng ngủ", aliases: ["phong ngu", "bedroom", "bed room"] },
  { label: "Nhà bếp", aliases: ["nha bep", "kitchen"] },
  { label: "Phòng tắm", aliases: ["phong tam", "bathroom", "bath room"] },
  { label: "Cửa vào", aliases: ["cua vao", "entrance", "door"] },
  { label: "Sân nhà", aliases: ["san nha", "san", "yard", "outdoor", "garden", "ban cong", "balcony"] },
];

const getDefaultBackendIp = () => {
  const expoHost =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    "";
  const host = expoHost.split(":")[0];

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return `${host}:8000`;
  }

  return FALLBACK_BACKEND_IP;
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .trim();

const getLightLabel = (value: number) => {
  if (value > DARK_LIGHT_VALUE) return "Tối";
  if (value < BRIGHT_LIGHT_VALUE) return "Sáng";
  return "Vừa";
};

const registerPushToken = async (apiUrl: string) => {
  if (!DeviceInfo.isDevice) {
    return;
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermission.status;

  if (finalStatus !== "granted") {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  if (finalStatus !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId;

  const tokenResult = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  await axios.post(`${apiUrl}/notifications/register`, {
    token: tokenResult.data,
    platform: Platform.OS,
  });
};

export default function HomeScreen() {
  const [isDark, setIsDark] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [serverIp, setServerIp] = useState(getDefaultBackendIp);
  const [tempIp, setTempIp] = useState(getDefaultBackendIp);
  const [isIpModalOpen, setIsIpModalOpen] = useState(false);
  const [doorPassword, setDoorPassword] = useState("");
  const [doorPasswordConfirm, setDoorPasswordConfirm] = useState("");
  const [isDoorPasswordSaving, setIsDoorPasswordSaving] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [gas, setGas] = useState(0);
  const [light, setLight] = useState(0);
  const [raining, setRaining] = useState(false);
  const [motionDetected, setMotionDetected] = useState(false);
  const [temperature, setTemperature] = useState(0);
  const [humidity, setHumidity] = useState(0);
  const [automaticLight, setAutomaticLight] = useState(false);
  const [automaticClothes, setAutomaticClothes] = useState(false);
  const [automaticYardLight, setAutomaticYardLight] = useState(false);
  const [gasAlertEnabled, setGasAlertEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("Tất cả");
  const [chatOpen, setChatOpen] = useState(false);
  const [assistantText, setAssistantText] = useState("Nhập lệnh để điều khiển nhà thông minh.");
  const [manualCommand, setManualCommand] = useState("");
  const [lastUserCommand, setLastUserCommand] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const gasPulseAnim = useRef(new Animated.Value(1)).current;
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const voicePressRecordingRef = useRef(false);
  const lastLocalGasAlertAtRef = useRef(0);

  const getApiUrl = useCallback(() => {
    const formattedIp = serverIp.trim();
    if (!formattedIp.startsWith("http")) {
      return `http://${formattedIp}`.replace(/\/+$/, "");
    }
    return formattedIp.replace(/\/+$/, "");
  }, [serverIp]);

  const now = new Date();
  const formattedDate = now
    .toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      timeZone: "Asia/Ho_Chi_Minh",
    })
    .toUpperCase();
  const formattedTime = now.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const gasIsDanger = gas >= MAX_GAS_VALUE;
  const activeDeviceCount = devices.filter((device) => device.status).length;

  const fetchDevices = useCallback(async (showSilently = true) => {
    if (!showSilently) setLoading(true);
    try {
      const response = await axios.get(`${getApiUrl()}/devices/`, {
        timeout: POLLING_REQUEST_TIMEOUT_MS,
      });
      setDevices(response.data);
      setConnectionError("");
    } catch (error) {
      console.log("Error fetching devices:", error);
      setConnectionError("Không kết nối được backend");
    } finally {
      if (!showSilently) setLoading(false);
    }
  }, [getApiUrl]);

  const fetchSensorData = useCallback(async () => {
    try {
      const response = await axios.get(`${getApiUrl()}/sensor-data/latest`, {
        timeout: POLLING_REQUEST_TIMEOUT_MS,
      });
      const data = response.data || {};
      setGas(data.gas || 0);
      setLight(data.light || 0);
      setRaining(Boolean(data.raining));
      setMotionDetected(Boolean(data.motionDetected));
      setTemperature(data.temperature || 0);
      setHumidity(data.humidity || 0);
    } catch (error) {
      console.log("Error fetching sensors:", error);
    }
  }, [getApiUrl]);

  const fetchAutomaticLightStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${getApiUrl()}/devices/automatic-light/status`, {
        timeout: POLLING_REQUEST_TIMEOUT_MS,
      });
      setAutomaticLight(Boolean(response.data.automatic));
    } catch (error) {
      console.log("Error fetching automatic light:", error);
    }
  }, [getApiUrl]);

  const fetchAutomaticClothesStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${getApiUrl()}/devices/automatic-clothes/status`, {
        timeout: POLLING_REQUEST_TIMEOUT_MS,
      });
      setAutomaticClothes(Boolean(response.data.automatic));
      setRaining(Boolean(response.data.raining));
    } catch (error) {
      console.log("Error fetching automatic clothes:", error);
    }
  }, [getApiUrl]);

  const fetchAutomaticYardLightStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${getApiUrl()}/devices/automatic-yard-light/status`, {
        timeout: POLLING_REQUEST_TIMEOUT_MS,
      });
      setAutomaticYardLight(Boolean(response.data.automatic));
      if (typeof response.data.motionDetected === "boolean") {
        setMotionDetected(response.data.motionDetected);
      }
    } catch (error) {
      console.log("Error fetching automatic yard light:", error);
    }
  }, [getApiUrl]);

  useEffect(() => {
    fetchDevices(false);
    fetchSensorData();
    fetchAutomaticLightStatus();
    fetchAutomaticClothesStatus();
    fetchAutomaticYardLightStatus();

    const sensorInterval = setInterval(fetchSensorData, SENSOR_REFRESH_INTERVAL_MS);
    const deviceInterval = setInterval(() => fetchDevices(true), DEVICE_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(sensorInterval);
      clearInterval(deviceInterval);
    };
  }, [fetchAutomaticClothesStatus, fetchAutomaticLightStatus, fetchAutomaticYardLightStatus, fetchDevices, fetchSensorData]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    if (gasIsDanger) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(gasPulseAnim, { toValue: 0.45, duration: 500, useNativeDriver: true }),
          Animated.timing(gasPulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      gasPulseAnim.setValue(1);
    }
  }, [gasIsDanger, gasPulseAnim]);

  useEffect(() => {
    (async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (permission.granted) {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }
    })();
  }, []);

  useEffect(() => {
    registerPushToken(getApiUrl()).catch((error) => {
      console.log("Error registering push token:", error);
    });
  }, [getApiUrl]);

  useEffect(() => {
    if (!gasAlertEnabled || !gasIsDanger) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs - lastLocalGasAlertAtRef.current < 60000) {
      return;
    }

    lastLocalGasAlertAtRef.current = nowMs;

    Notifications.scheduleNotificationAsync({
      content: {
        title: "Cảnh báo khí gas",
        body: `Giá trị gas đang nguy hiểm: ${gas}. Hãy kiểm tra ngay.`,
        data: {
          type: "gas_alert",
          gas,
          threshold: MAX_GAS_VALUE,
        },
      },
      trigger: null,
    }).catch((error) => {
      console.log("Error showing local gas alert:", error);
    });
  }, [gas, gasAlertEnabled, gasIsDanger]);

  const isLightDevice = (device: Device) => {
    const name = normalizeText(device.name || "");
    const type = normalizeText(device.type || "");
    return name.includes("den") || name.includes("light") || type.includes("light");
  };

  const setDeviceStatus = async (device: Device, action: DeviceAction) => {
    try {
      const nextStatus = action === "on";
      setDevices((currentDevices) =>
        currentDevices.map((currentDevice) =>
          currentDevice.id === device.id ? { ...currentDevice, status: nextStatus } : currentDevice
        )
      );

      const deviceText = normalizeText(`${device.name || ""} ${device.room || ""} ${device.type || ""}`);
      const isYardLight = device.pin === 33 || deviceText.includes("san") || deviceText.includes("yard") || deviceText.includes("outdoor");

      if (isYardLight) {
        setAutomaticYardLight(false);
      } else if (isLightDevice(device)) {
        setAutomaticLight(false);
      }

      const response = await axios.post(
        `${getApiUrl()}/devices/${device.id}`,
        { action },
        { timeout: DEVICE_CONTROL_TIMEOUT_MS }
      );

      if (typeof response.data?.automatic === "boolean") {
        setAutomaticLight(response.data.automatic);
      }
      if (typeof response.data?.automaticYard === "boolean") {
        setAutomaticYardLight(response.data.automaticYard);
      }

      return true;
    } catch (error) {
      console.log("Error controlling device:", error);
      if (isAxiosError(error) && error.response?.status === 504) {
        setConnectionError("ESP32 phản hồi chậm, đang cập nhật lại trạng thái");
        setTimeout(() => fetchDevices(true), 1200);
        return true;
      }
      Alert.alert("Lỗi", "Không thể kết nối với thiết bị ESP32.");
      return false;
    }
  };

  const toggleDevice = async (device: Device) => {
    await setDeviceStatus(device, device.status ? "off" : "on");
  };

  const toggleAutomaticLight = async () => {
    try {
      const action = automaticLight ? "off" : "on";
      const response = await axios.post(`${getApiUrl()}/devices/automatic-light/mode`, { action });
      setAutomaticLight(Boolean(response.data.automatic));
      await fetchDevices(true);
    } catch (error) {
      console.log("Error automatic light:", error);
      Alert.alert("Tự động", "Không bật/tắt được đèn tự động trên ESP32.");
    }
  };

  const toggleAutomaticClothes = async () => {
    try {
      const action = automaticClothes ? "off" : "on";
      const response = await axios.post(`${getApiUrl()}/devices/automatic-clothes/mode`, { action });
      setAutomaticClothes(Boolean(response.data.automatic));
      setRaining(Boolean(response.data.raining));
      await fetchDevices(true);
    } catch (error) {
      console.log("Error automatic clothes:", error);
      Alert.alert("Tự động", "Không bật/tắt được phơi đồ tự động trên ESP32.");
    }
  };

  const toggleAutomaticYardLight = async () => {
    try {
      const action = automaticYardLight ? "off" : "on";
      const response = await axios.post(`${getApiUrl()}/devices/automatic-yard-light/mode`, { action });
      setAutomaticYardLight(Boolean(response.data.automatic));
      if (typeof response.data.motionDetected === "boolean") {
        setMotionDetected(response.data.motionDetected);
      }
      await fetchDevices(true);
    } catch (error) {
      console.log("Error automatic yard light:", error);
      Alert.alert("Tự động", "Không bật/tắt được đèn sân tự động trên ESP32.");
    }
  };

  const updateDoorPassword = async () => {
    const password = doorPassword.trim();
    const confirmation = doorPasswordConfirm.trim();

    if (!/^\d{4,12}$/.test(password)) {
      Alert.alert("Mat khau cua", "Mat khau phai gom 4-12 chu so.");
      return;
    }

    if (password !== confirmation) {
      Alert.alert("Mat khau cua", "Mat khau xac nhan khong khop.");
      return;
    }

    try {
      setIsDoorPasswordSaving(true);
      await axios.post(
        `${getApiUrl()}/door/password`,
        { password },
        { timeout: DEVICE_CONTROL_TIMEOUT_MS }
      );
      setDoorPassword("");
      setDoorPasswordConfirm("");
      Alert.alert("Mat khau cua", "Da cap nhat mat khau keypad.");
    } catch (error) {
      console.log("Error updating door password:", error);
      Alert.alert("Mat khau cua", "Khong cap nhat duoc mat khau tren ESP cua.");
    } finally {
      setIsDoorPasswordSaving(false);
    }
  };

  const handleAssistantCommand = async (command: string) => {
    if (!command.trim()) return;
    try {
      setIsAiLoading(true);
      setLastUserCommand(command.trim());
      setAssistantText("Đang xử lý lệnh...");
      const response = await axios.post(`${getApiUrl()}/assistant/voice-command`, { command });
      setAssistantText(response.data.message || "Đã xử lý lệnh.");
      await fetchDevices(true);
    } catch (error) {
      console.log("Error AI:", error);
      setAssistantText("Trợ lý AI hoặc backend không phản hồi.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const sendVoiceAudio = async (uri: string) => {
    try {
      setIsAiLoading(true);
      setLastUserCommand("Đã gửi lệnh bằng giọng nói");
      setAssistantText("Đang gửi audio lên Gemini...");

      const formData = new FormData();
      formData.append("audio", {
        uri,
        name: "voice-command.m4a",
        type: "audio/m4a",
      } as unknown as Blob);

      const response = await axios.post(`${getApiUrl()}/assistant/voice-audio`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAssistantText(response.data.message || "Đã xử lý lệnh giọng nói.");
      await fetchDevices(true);
    } catch (error) {
      console.log("Error voice AI:", error);
      setAssistantText("Backend không xử lý được audio này.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const startVoiceRecording = async () => {
    if (isAiLoading || recorderState.isRecording || voicePressRecordingRef.current) return;

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Micro", "Ứng dụng chưa có quyền sử dụng micro.");
        return;
      }
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      voicePressRecordingRef.current = true;
      setAssistantText("Đang nghe lệnh của bạn...");
    } catch (error) {
      voicePressRecordingRef.current = false;
      console.log("Error start recording:", error);
      setAssistantText("Không bật được micro.");
    }
  };

  const stopVoiceRecording = async () => {
    if (!voicePressRecordingRef.current) return;
    voicePressRecordingRef.current = false;

    try {
      await audioRecorder.stop();
      if (audioRecorder.uri) await sendVoiceAudio(audioRecorder.uri);
    } catch (error) {
      console.log("Error stop recording:", error);
      setAssistantText("Không dừng được ghi âm.");
    }
  };

  const selectedRoomFilter = ROOM_FILTERS.find((room) => room.label === selectedRoom);
  const filteredDevices =
    !selectedRoomFilter || selectedRoomFilter.label === "Tất cả"
      ? devices
      : devices.filter((device) => {
          const deviceText = `${normalizeText(device.room || "")} ${normalizeText(device.name || "")} ${normalizeText(device.type || "")}`;
          return selectedRoomFilter.aliases.some((alias) => deviceText.includes(alias));
        });

  const getDeviceIconAndColor = (device: Device) => {
    const name = normalizeText(device.name || "");
    const type = normalizeText(device.type || "");
    const isOn = device.status;

    if (name.includes("den") || type.includes("light")) {
      return { icon: "lightbulb-outline" as IconName, activeIcon: "lightbulb" as IconName, color: isOn ? "#F59E0B" : "#94A3B8", accent: "#F59E0B", bg: "#FEF3C7" };
    }
    if (name.includes("cua") || type.includes("door")) {
      return { icon: "door-closed" as IconName, activeIcon: "door-open" as IconName, color: isOn ? "#0EA5E9" : "#94A3B8", accent: "#0EA5E9", bg: "#E0F2FE" };
    }
    if (name.includes("phoi") || type.includes("clothes")) {
      return { icon: "hanger" as IconName, activeIcon: "hanger" as IconName, color: isOn ? "#2563EB" : "#94A3B8", accent: "#2563EB", bg: "#DBEAFE" };
    }
    return { icon: "power-plug-outline" as IconName, activeIcon: "power-plug" as IconName, color: isOn ? "#16A34A" : "#94A3B8", accent: "#16A34A", bg: "#DCFCE7" };
  };

  const renderMetric = (icon: IconName, label: string, value: string, status: string, color: string) => (
    <View style={[styles.metricCard, isDark && styles.surfaceDark]}>
      <View style={[styles.metricIcon, { backgroundColor: `${color}18` }]}>
        <MaterialCommunityIcons name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.metricValue, isDark && styles.textDark]}>{value}</Text>
      <Text style={[styles.metricLabel, isDark && styles.mutedDark]}>{label}</Text>
      {!!status && <Text style={[styles.metricStatus, { color }]}>{status}</Text>}
    </View>
  );

  const renderDeviceTile = (device: Device) => {
    const spec = getDeviceIconAndColor(device);
    const isOn = device.status;

    return (
      <TouchableOpacity
        key={device.id}
        style={[styles.deviceTile, isDark && styles.surfaceDark, isOn && { borderColor: spec.accent }]}
        onPress={() => toggleDevice(device)}
        activeOpacity={0.72}
      >
        <View style={styles.deviceTopRow}>
          <View style={[styles.tileIconContainer, { backgroundColor: spec.bg }]}>
            <MaterialCommunityIcons name={isOn ? spec.activeIcon : spec.icon} size={26} color={spec.color} />
          </View>
          <View style={[styles.deviceSwitchDot, isOn && { backgroundColor: spec.accent }]} />
        </View>
        <Text style={[styles.tileDeviceName, isDark && styles.textDark]} numberOfLines={1}>{device.name}</Text>
        <Text style={[styles.tileDeviceRoom, isDark && styles.mutedDark]} numberOfLines={1}>{device.room}</Text>
        <Text style={[styles.tileStatusText, isOn ? { color: spec.accent } : styles.tileStatusOffText]}>
          {isOn ? "ON" : "OFF"}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderHomeTop = () => (
    <>
      <View style={styles.homeBrandHeader}>
        <View style={styles.brandLeft}>
          <View style={styles.brandMark}>
            <MaterialCommunityIcons name="home-automation" size={17} color="#2563EB" />
          </View>
          <Text style={styles.brandName}>Lumina Home</Text>
        </View>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => {
            setTempIp(serverIp);
            setIsIpModalOpen(true);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="wifi-outline" size={19} color="#64748B" />
        </TouchableOpacity>
      </View>

      <View style={styles.homeIntroPanel}>
        <View style={styles.homeIntroTopRow}>
          <Text style={styles.homeDate}>{formattedDate}</Text>
          <View style={styles.weatherMini}>
            <Ionicons name="time-outline" size={17} color="#F97316" />
            <Text style={styles.weatherMiniText}>{formattedTime}</Text>
          </View>
        </View>
        <View style={styles.homeIntroBottomRow}>
          <View>
            <Text style={styles.homeHintText}>Hệ thống đang theo dõi ngôi nhà.</Text>
          </View>
          <Text style={styles.weatherDescText}>Kết nối LAN</Text>
        </View>
      </View>
    </>
  );

  const renderHome = () => (
    <>
      {renderHomeTop()}

      {!!connectionError && (
        <View style={styles.connectionBanner}>
          <Ionicons name="warning-outline" size={16} color="#1D4ED8" />
          <Text style={styles.connectionBannerText}>{connectionError}</Text>
        </View>
      )}

      <View style={styles.summaryRow}>
        <View style={[styles.summaryItem, isDark && styles.surfaceDark]}>
          <Text style={[styles.summaryValue, isDark && styles.textDark]}>{devices.length}</Text>
          <Text style={styles.summaryLabel}>Thiết bị</Text>
        </View>
        <View style={[styles.summaryItem, isDark && styles.surfaceDark]}>
          <Text style={[styles.summaryValue, isDark && styles.textDark]}>{activeDeviceCount}</Text>
          <Text style={styles.summaryLabel}>Đang bật</Text>
        </View>
        <View style={[styles.summaryItem, isDark && styles.surfaceDark]}>
          <Text style={[styles.summaryValue, gasIsDanger && { color: "#DC2626" }]}>{gasIsDanger ? "Gas" : "OK"}</Text>
          <Text style={styles.summaryLabel}>An toàn</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Chỉ số ngôi nhà</Text>
      <View style={styles.metricsGrid}>
        {renderMetric("thermometer", "Nhiệt độ", `${temperature}°C`, "DHT11", "#F97316")}
        {renderMetric("water-percent", "Độ ẩm", `${humidity}%`, "DHT11", "#2563EB")}
        <Animated.View style={[styles.metricCard, isDark && styles.surfaceDark, gasIsDanger && styles.dangerMetric, { opacity: gasPulseAnim }]}>
          <View style={[styles.metricIcon, { backgroundColor: gasIsDanger ? "#FEE2E2" : "#DCFCE7" }]}>
            <MaterialCommunityIcons name={gasIsDanger ? "alert-circle-outline" : "shield-check-outline"} size={22} color={gasIsDanger ? "#DC2626" : "#16A34A"} />
          </View>
          <Text style={[styles.metricValue, gasIsDanger && { color: "#DC2626" }]}>{gas}</Text>
          <Text style={styles.metricLabel}>Khí gas</Text>
          <Text style={[styles.metricStatus, { color: gasIsDanger ? "#DC2626" : "#16A34A" }]}>
            {gasIsDanger ? "Nguy hiểm" : "An toàn"}
          </Text>
        </Animated.View>
        {renderMetric(raining ? "weather-pouring" : "weather-partly-cloudy", "Cảm biến mưa", raining ? "Mưa" : "Khô", "", raining ? "#2563EB" : "#64748B")}
        {renderMetric(motionDetected ? "motion-sensor" : "motion-sensor-off", "Hồng ngoại", motionDetected ? "Có người" : "Không có", "", motionDetected ? "#2563EB" : "#64748B")}
        {renderMetric("white-balance-sunny", "Ánh sáng", getLightLabel(light), "", "#F59E0B")}
      </View>
    </>
  );

  const renderRooms = () => (
    <>
      {renderHeader("Phòng", "Quản lý thiết bị theo phòng")}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomChipsScroll} style={styles.roomFilterWrapper}>
        {ROOM_FILTERS.map((room) => {
          const isActive = selectedRoom === room.label;
          return (
            <TouchableOpacity key={room.label} style={[styles.roomChip, isDark && styles.surfaceDark, isActive && styles.roomChipActive]} onPress={() => setSelectedRoom(room.label)}>
              <Text style={[styles.roomChipText, isActive && styles.roomChipTextActive]}>{room.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={styles.devicesHeader}>
        <Text style={styles.sectionTitle}>Thiết bị</Text>
        <Text style={styles.devicesCount}>{filteredDevices.filter((device) => device.status).length}/{filteredDevices.length} ON</Text>
      </View>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color="#2563EB" /></View>
      ) : filteredDevices.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="home-lightning-bolt" size={42} color="#94A3B8" />
          <Text style={styles.emptyText}>Không có thiết bị trong khu vực này</Text>
        </View>
      ) : (
        <View style={styles.devicesGrid}>{filteredDevices.map(renderDeviceTile)}</View>
      )}
    </>
  );

  const renderHeader = (title: string, subtitle: string) => (
    <View style={styles.appHeader}>
      <View>
        <Text style={styles.appTitle}>{title}</Text>
        <Text style={styles.appSubtitle}>{subtitle}</Text>
      </View>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={() => {
          setTempIp(serverIp);
          setIsIpModalOpen(true);
        }}
      >
        <Ionicons name="wifi-outline" size={20} color="#2563EB" />
      </TouchableOpacity>
    </View>
  );

  const renderAutomationRow = (icon: IconName, title: string, description: string, enabled: boolean, onToggle: () => void, color: string) => (
    <View style={[styles.automationRow, isDark && styles.surfaceDark]}>
      <View style={[styles.automationIcon, { backgroundColor: `${color}16` }]}>
        <MaterialCommunityIcons name={icon} size={22} color={color} />
      </View>
      <View style={styles.automationTextBlock}>
        <Text style={styles.automationTitle}>{title}</Text>
        <Text style={styles.automationDesc}>{description}</Text>
      </View>
      <Switch value={enabled} onValueChange={onToggle} trackColor={{ false: "#CBD5E1", true: "#93C5FD" }} thumbColor={enabled ? "#2563EB" : "#F8FAFC"} />
    </View>
  );

  const renderAutomations = () => (
    <>
      {renderHeader("Tự động", "Thiết lập các chế độ tự động")}
      <View style={styles.sceneGrid}>
        <View style={[styles.sceneCard, isDark && styles.surfaceDark]}>
          <MaterialCommunityIcons name="weather-night" size={22} color="#2563EB" />
          <Text style={styles.sceneTitle}>Night Mode</Text>
          <Text style={styles.sceneDesc}>Đèn và cửa</Text>
        </View>
        <View style={[styles.sceneCard, isDark && styles.surfaceDark]}>
          <MaterialCommunityIcons name="weather-sunset" size={22} color="#F97316" />
          <Text style={styles.sceneTitle}>An toàn khi mưa</Text>
          <Text style={styles.sceneDesc}>Giàn phơi</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Chế độ đang dùng</Text>
      {renderAutomationRow("lightbulb-auto", "Đèn tự động", "Bật đèn khi trời tối, tắt khi trời sáng", automaticLight, toggleAutomaticLight, "#F59E0B")}
      {renderAutomationRow("outdoor-lamp", "Đèn sân tự động", "Trời tối và có người thì bật đèn sân", automaticYardLight, toggleAutomaticYardLight, "#F59E0B")}
      {renderAutomationRow("hanger", "Giàn phơi tự động", "Có mưa thì kéo vào, khô thì đẩy ra", automaticClothes, toggleAutomaticClothes, "#2563EB")}
      {renderAutomationRow(gasAlertEnabled ? "bell-alert-outline" : "bell-off-outline", "Cảnh báo gas", `Thông báo khi gas vượt ngưỡng ${MAX_GAS_VALUE}`, gasAlertEnabled, () => setGasAlertEnabled((enabled) => !enabled), gasIsDanger ? "#DC2626" : "#16A34A")}
    </>
  );

  const renderProfile = () => (
    <>
      {renderHeader("Cá nhân", "Cấu hình hệ thống")}
      <View style={[styles.profileCard, isDark && styles.surfaceDark]}>
        <View style={styles.profileAvatar}>
          <Ionicons name="home" size={28} color="#FFFFFF" />
        </View>
        <View style={styles.profileTextBlock}>
          <Text style={styles.profileTitle}>Lumina Home</Text>
          <Text style={styles.profileSubtitle}>Backend: {serverIp}</Text>
        </View>
      </View>
      {!!connectionError && (
        <View style={styles.connectionBanner}>
          <Ionicons name="warning-outline" size={16} color="#1D4ED8" />
          <Text style={styles.connectionBannerText}>{connectionError}</Text>
        </View>
      )}
      <View style={[styles.themeRow, isDark && styles.surfaceDark]}>
        <View style={styles.themeIconWrap}>
          <Ionicons name={isDark ? "moon" : "sunny"} size={18} color="#2563EB" />
        </View>
        <View style={styles.themeTextBlock}>
          <Text style={[styles.themeTitle, isDark && styles.textDark]}>
            Giao diện
          </Text>
          <Text style={[styles.themeSubtitle, isDark && styles.mutedDark]}>
            {isDark ? "Dark mode" : "Light mode"}
          </Text>
        </View>
        <Switch
          value={isDark}
          onValueChange={setIsDark}
          trackColor={{ false: "#CBD5E1", true: "#93C5FD" }}
          thumbColor={isDark ? "#2563EB" : "#F8FAFC"}
        />
      </View>
      <View style={[styles.passwordCard, isDark && styles.surfaceDark]}>
        <View style={styles.passwordHeader}>
          <View style={styles.themeIconWrap}>
            <MaterialCommunityIcons name="form-textbox-password" size={18} color="#2563EB" />
          </View>
          <View style={styles.themeTextBlock}>
            <Text style={[styles.themeTitle, isDark && styles.textDark]}>
              Mat khau keypad cua
            </Text>
            <Text style={[styles.themeSubtitle, isDark && styles.mutedDark]}>
              Dung phim # de xac nhan, phim * de xoa tren keypad
            </Text>
          </View>
        </View>
        <TextInput
          value={doorPassword}
          onChangeText={setDoorPassword}
          style={styles.passwordInput}
          placeholder="Mat khau moi"
          placeholderTextColor="#64748B"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={12}
        />
        <TextInput
          value={doorPasswordConfirm}
          onChangeText={setDoorPasswordConfirm}
          style={styles.passwordInput}
          placeholder="Nhap lai mat khau"
          placeholderTextColor="#64748B"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={12}
        />
        <TouchableOpacity
          style={[styles.primaryButton, isDoorPasswordSaving && styles.disabledButton]}
          onPress={updateDoorPassword}
          disabled={isDoorPasswordSaving}
        >
          {isDoorPasswordSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="keypad-outline" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.primaryButtonText}>
            {isDoorPasswordSaving ? "Dang luu..." : "Luu mat khau"}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => {
          setTempIp(serverIp);
          setIsIpModalOpen(true);
        }}
      >
        <Ionicons name="wifi-outline" size={18} color="#FFFFFF" />
        <Text style={styles.primaryButtonText}>Đổi Server IP</Text>
      </TouchableOpacity>
    </>
  );

  const renderActiveTab = () => {
    if (activeTab === "rooms") return renderRooms();
    if (activeTab === "automations") return renderAutomations();
    if (activeTab === "profile") return renderProfile();
    return renderHome();
  };

  const bottomTabs: { key: AppTab; label: string; icon: IconName }[] = [
    { key: "home", label: "NHÀ", icon: "view-dashboard-outline" },
    { key: "rooms", label: "PHÒNG", icon: "door-open" },
    { key: "automations", label: "TỰ ĐỘNG", icon: "tune-variant" },
    { key: "profile", label: "CÁ NHÂN", icon: "account-outline" },
  ];

  const assistantSuggestions = ["Bật toàn bộ đèn", "Tắt toàn bộ đèn", "Bật đèn phòng khách", "Đóng cửa chính", "Mở cửa chính"];

  return (
    <SafeAreaView style={[styles.safeArea, isDark && styles.safeAreaDark]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <View style={[styles.screen, isDark && styles.screenDark]}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {renderActiveTab()}
        <View style={{ height: 126 }} />
      </ScrollView>

      <Modal visible={isIpModalOpen} transparent animationType="fade" onRequestClose={() => setIsIpModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDark && styles.surfaceDark]}>
            <Text style={styles.modalTitle}>Cấu hình Server IP</Text>
            <Text style={styles.modalDesc}>Nhập địa chỉ IP và port của backend FastAPI trong mạng LAN.</Text>
            <TextInput value={tempIp} onChangeText={setTempIp} style={styles.modalInput} placeholder="Ví dụ: 192.168.1.100:8000" placeholderTextColor="#64748B" />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setIsIpModalOpen(false)}>
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

      <View style={[styles.bottomNav, isDark && styles.surfaceDark]}>
        {bottomTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity key={tab.key} style={[styles.bottomNavItem, isActive && styles.bottomNavItemActive]} onPress={() => setActiveTab(tab.key)} activeOpacity={0.8}>
              <MaterialCommunityIcons name={tab.icon} size={22} color={isActive ? "#2563EB" : "#64748B"} />
              <Text style={[styles.bottomNavText, isActive && styles.bottomNavTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.floatingContainer} pointerEvents="box-none">
        <Animated.View style={[styles.floatingOrbWrapper, { transform: [{ scale: pulseAnim }] }]}>
          <TouchableOpacity style={styles.chatAvatar} onPress={() => setChatOpen((previous) => !previous)} activeOpacity={0.9}>
            <Ionicons name="chatbubble-ellipses" size={23} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {chatOpen && (
        <KeyboardAvoidingView style={styles.chatPanelOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}>
          <View style={[styles.chatPanel, isDark && styles.surfaceDark]}>
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderInfo}>
                <View style={styles.chatBotIcon}>
                  <MaterialCommunityIcons name="robot-outline" size={18} color="#2563EB" />
                </View>
                <View>
                  <Text style={styles.chatTitle}>Trợ lý Lumina</Text>
                  <Text style={styles.chatSubtitle}>Điều khiển nhà bằng giọng nói hoặc câu lệnh</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setChatOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.chatMessages} showsVerticalScrollIndicator={false}>
              <View style={styles.assistantBubble}>
                <Text style={styles.assistantMessage}>Mình là Lumina, trợ lý nhà thông minh của bạn.</Text>
                <Text style={styles.chatTimeText}>Bây giờ</Text>
              </View>
              {!!lastUserCommand && (
                <View style={styles.userBubble}>
                  <Text style={styles.userMessage}>{lastUserCommand}</Text>
                  <Text style={styles.userTimeText}>Vừa gửi</Text>
                </View>
              )}
              <View style={styles.assistantBubble}>
                <Text style={styles.assistantMessage}>{assistantText}</Text>
                <Text style={styles.chatTimeText}>Lumina</Text>
              </View>
              {isAiLoading && (
                <View style={styles.chatLoadingRow}>
                  <ActivityIndicator size="small" color="#2563EB" />
                  <Text style={styles.chatLoadingText}>Gemini đang phân tích...</Text>
                </View>
              )}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assistantSuggestions}>
              {assistantSuggestions.map((suggestion) => (
                <TouchableOpacity key={suggestion} style={styles.assistantSuggestionChip} onPress={() => handleAssistantCommand(suggestion)} activeOpacity={0.82}>
                  <Text style={styles.assistantSuggestionText}>{suggestion}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.micRow}>
              <TouchableOpacity style={[styles.bigMicButton, recorderState.isRecording && styles.bigMicButtonRecording]} disabled={isAiLoading} onPressIn={startVoiceRecording} onPressOut={stopVoiceRecording} activeOpacity={0.85}>
                <Ionicons name={recorderState.isRecording ? "stop" : "mic"} size={27} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.chatInputRow}>
              <TextInput
                value={manualCommand}
                onChangeText={setManualCommand}
                placeholder="Nhập yêu cầu..."
                placeholderTextColor="#94A3B8"
                style={styles.commandInput}
                onSubmitEditing={() => {
                  if (manualCommand.trim()) {
                    handleAssistantCommand(manualCommand.trim());
                    setManualCommand("");
                  }
                }}
              />
              <TouchableOpacity
                style={styles.sendButton}
                disabled={isAiLoading}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#F4F8FC", flex: 1 },
  safeAreaDark: { backgroundColor: "#07111F" },
  screen: { backgroundColor: "#F4F8FC", flex: 1 },
  screenDark: { backgroundColor: "#07111F" },
  surfaceDark: { backgroundColor: "#101B2D", borderColor: "#1F2B3D" },
  textDark: { color: "#F8FAFC" },
  mutedDark: { color: "#A8B3C7" },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 46 },
  homeBrandHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  brandLeft: { alignItems: "center", flexDirection: "row", gap: 7 },
  brandMark: { alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 8, height: 28, justifyContent: "center", width: 28 },
  brandName: { color: "#2563EB", fontSize: 15, fontWeight: "900" },
  headerIconButton: { alignItems: "center", height: 34, justifyContent: "center", width: 34 },
  homeIntroPanel: { marginBottom: 18 },
  homeIntroTopRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  homeDate: { color: "#94A3B8", fontSize: 12, fontWeight: "800" },
  weatherMini: { alignItems: "center", flexDirection: "row", gap: 4 },
  weatherMiniText: { color: "#C2410C", fontSize: 13, fontWeight: "800" },
  homeIntroBottomRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  greetingText: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  homeHintText: { color: "#64748B", fontSize: 11, fontWeight: "600", marginTop: 3 },
  weatherDescText: { color: "#64748B", fontSize: 12, fontWeight: "600", marginTop: 1, textAlign: "right" },
  appHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  appTitle: { color: "#111827", fontSize: 25, fontWeight: "900" },
  appSubtitle: { color: "#94A3B8", fontSize: 12, fontWeight: "600", marginTop: 2 },
  iconButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 2, height: 42, justifyContent: "center", shadowColor: "#2563EB", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 10, width: 42 },
  connectionBanner: { alignItems: "center", backgroundColor: "#DBEAFE", borderColor: "#BFDBFE", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 8, marginBottom: 12, padding: 10 },
  connectionBannerText: { color: "#1E3A8A", flex: 1, fontSize: 12, fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  summaryItem: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 5, flex: 1, padding: 12, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.1, shadowRadius: 14 },
  summaryValue: { color: "#111827", fontSize: 20, fontWeight: "900" },
  summaryLabel: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 2 },
  sectionTitle: { color: "#1E293B", fontSize: 16, fontWeight: "900", marginBottom: 12 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 5, minHeight: 132, padding: 12, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 16, width: "48%" },
  dangerMetric: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  metricIcon: { alignItems: "center", borderRadius: 8, height: 36, justifyContent: "center", marginBottom: 12, width: 36 },
  metricValue: { color: "#0F172A", fontSize: 22, fontWeight: "900" },
  metricLabel: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 2 },
  metricStatus: { fontSize: 11, fontWeight: "800", marginTop: 8 },
  roomFilterWrapper: { marginBottom: 16 },
  roomChipsScroll: { gap: 8, paddingRight: 12 },
  roomChip: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 3, paddingHorizontal: 14, paddingVertical: 9, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10 },
  roomChipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  roomChipText: { color: "#64748B", fontSize: 12, fontWeight: "800" },
  roomChipTextActive: { color: "#FFFFFF" },
  devicesHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  devicesCount: { backgroundColor: "#DBEAFE", borderRadius: 8, color: "#2563EB", fontSize: 11, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 4 },
  devicesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" },
  deviceTile: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 5, minHeight: 148, padding: 14, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 16, width: "48%" },
  deviceTopRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  tileIconContainer: { alignItems: "center", borderRadius: 8, height: 42, justifyContent: "center", width: 42 },
  deviceSwitchDot: { backgroundColor: "#CBD5E1", borderRadius: 5, height: 10, width: 10 },
  tileDeviceName: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  tileDeviceRoom: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 3 },
  tileStatusText: { fontSize: 11, fontWeight: "900", marginTop: 14 },
  tileStatusOffText: { color: "#94A3B8" },
  centered: { alignItems: "center", justifyContent: "center", paddingVertical: 42 },
  emptyContainer: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, gap: 8, justifyContent: "center", paddingVertical: 48 },
  emptyText: { color: "#64748B", fontSize: 13, fontWeight: "700" },
  sceneGrid: { flexDirection: "row", gap: 12, marginBottom: 18 },
  sceneCard: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 5, flex: 1, padding: 14, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 16 },
  sceneTitle: { color: "#0F172A", fontSize: 13, fontWeight: "900", marginTop: 10 },
  sceneDesc: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 2 },
  automationRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 5, flexDirection: "row", gap: 12, marginBottom: 10, padding: 12, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.09, shadowRadius: 16 },
  automationIcon: { alignItems: "center", borderRadius: 8, height: 42, justifyContent: "center", width: 42 },
  automationTextBlock: { flex: 1 },
  automationTitle: { color: "#0F172A", fontSize: 14, fontWeight: "900" },
  automationDesc: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 2 },
  profileCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 2, flexDirection: "row", gap: 14, marginBottom: 14, padding: 14, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.06, shadowRadius: 12 },
  profileAvatar: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 8, height: 54, justifyContent: "center", width: 54 },
  profileTextBlock: { flex: 1 },
  profileTitle: { color: "#0F172A", fontSize: 17, fontWeight: "900" },
  profileSubtitle: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 2 },
  themeRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 2, flexDirection: "row", gap: 12, marginBottom: 14, padding: 12, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.06, shadowRadius: 12 },
  themeIconWrap: { alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 8, height: 38, justifyContent: "center", width: 38 },
  themeTextBlock: { flex: 1 },
  themeTitle: { color: "#0F172A", fontSize: 14, fontWeight: "900" },
  themeSubtitle: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 2 },
  passwordCard: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, elevation: 2, gap: 10, marginBottom: 14, padding: 12, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.06, shadowRadius: 12 },
  passwordHeader: { alignItems: "center", flexDirection: "row", gap: 12 },
  passwordInput: { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, color: "#0F172A", fontSize: 14, fontWeight: "700", paddingHorizontal: 12, paddingVertical: 11 },
  primaryButton: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 8, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4, paddingVertical: 13 },
  disabledButton: { opacity: 0.7 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  bottomNav: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderTopWidth: 1, bottom: 0, elevation: 12, flexDirection: "row", height: 76, justifyContent: "space-around", left: 0, paddingBottom: 8, position: "absolute", right: 0, shadowColor: "#0F172A", shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.08, shadowRadius: 14 },
  bottomNavItem: { alignItems: "center", borderRadius: 8, flex: 1, gap: 4, justifyContent: "center", marginHorizontal: 4, paddingVertical: 7 },
  bottomNavItemActive: { backgroundColor: "#EFF6FF" },
  bottomNavText: { color: "#64748B", fontSize: 9, fontWeight: "900" },
  bottomNavTextActive: { color: "#2563EB" },
  floatingContainer: { alignItems: "flex-end", bottom: 86, left: 20, pointerEvents: "box-none", position: "absolute", right: 16, zIndex: 10 },
  floatingOrbWrapper: { borderRadius: 26, elevation: 8, shadowColor: "#2563EB", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 12 },
  chatAvatar: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 26, height: 52, justifyContent: "center", width: 52 },
  chatPanelOverlay: { backgroundColor: "rgba(15, 23, 42, 0.22)", bottom: 0, justifyContent: "flex-end", left: 0, position: "absolute", right: 0, top: 0, zIndex: 100 },
  chatPanel: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SCREEN.height * 0.68, padding: 18, paddingBottom: 24 },
  chatHeader: { alignItems: "center", borderBottomColor: "#E2E8F0", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12 },
  chatHeaderInfo: { alignItems: "center", flexDirection: "row", gap: 9 },
  chatBotIcon: { alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 10, height: 34, justifyContent: "center", width: 34 },
  chatTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  chatSubtitle: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 2 },
  closeButton: { alignItems: "center", backgroundColor: "#F1F5F9", borderRadius: 8, height: 32, justifyContent: "center", width: 32 },
  chatMessages: { marginBottom: 12, maxHeight: 190 },
  assistantBubble: { alignItems: "flex-start", backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#2563EB", borderRadius: 10, marginVertical: 10, maxWidth: "84%", padding: 12 },
  assistantMessage: { color: "#1E293B", flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 19 },
  userMessage: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", lineHeight: 19 },
  chatTimeText: { color: "#64748B", fontSize: 9, fontWeight: "700", marginTop: 8 },
  userTimeText: { alignSelf: "flex-end", color: "rgba(255,255,255,0.75)", fontSize: 9, fontWeight: "700", marginTop: 8 },
  chatLoadingRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 10 },
  chatLoadingText: { color: "#64748B", fontSize: 12, fontWeight: "700" },
  assistantSuggestions: { gap: 8, paddingBottom: 12, paddingTop: 2 },
  assistantSuggestionChip: { backgroundColor: "#F8FAFC", borderColor: "#DDE7F5", borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  assistantSuggestionText: { color: "#64748B", fontSize: 12, fontWeight: "800" },
  micRow: { alignItems: "center", marginBottom: 12 },
  bigMicButton: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 28, elevation: 8, height: 56, justifyContent: "center", shadowColor: "#2563EB", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 14, width: 56 },
  bigMicButtonRecording: { backgroundColor: "#DC2626", shadowColor: "#DC2626" },
  chatInputRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  commandInput: { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, color: "#0F172A", flex: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
  sendButton: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 8, height: 46, justifyContent: "center", width: 46 },
  modalOverlay: { alignItems: "center", backgroundColor: "rgba(15, 23, 42, 0.28)", flex: 1, justifyContent: "center", padding: 20 },
  modalContent: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, maxWidth: 340, padding: 22, width: "100%" },
  modalTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 8 },
  modalDesc: { color: "#64748B", fontSize: 12, fontWeight: "600", lineHeight: 18, marginBottom: 18 },
  modalInput: { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, color: "#0F172A", fontSize: 14, marginBottom: 18, paddingHorizontal: 12, paddingVertical: 11 },
  modalButtons: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  modalBtnCancel: { backgroundColor: "#F1F5F9" },
  modalBtnSave: { backgroundColor: "#2563EB" },
  modalBtnTextCancel: { color: "#64748B", fontSize: 13, fontWeight: "900" },
  modalBtnTextSave: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
});
