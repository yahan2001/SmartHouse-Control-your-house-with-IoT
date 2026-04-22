import { View, Text, Switch, StyleSheet } from 'react-native';
import { useState } from 'react';
import axios from 'axios';

export default function HomeScreen() {
  const [isOn, setIsOn] = useState(false);

  const API = "http://10.10.58.26:8000"; // 🔥 IP backend của bạn

  const toggle = async () => {
    try {
      if (isOn) {
        await axios.get(`${API}/off`);
        setIsOn(false);
      } else {
        await axios.get(`${API}/on`);
        setIsOn(true);
      }
    } catch (err) {
      console.log("Lỗi:", err);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏠 Smart Home</Text>

      <Text style={{ color: isOn ? "green" : "red", marginBottom: 10 }}>
        {isOn ? "Đang bật" : "Đang tắt"}
      </Text>

      <Switch value={isOn} onValueChange={toggle} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },
  title: {
    fontSize: 24,
    marginBottom: 20
  }
});