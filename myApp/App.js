import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  SafeAreaView
} from 'react-native';
import axios from 'axios';

export default function App() {
  const [isOn, setIsOn] = useState(false);

  const API = "http://10.10.58.108:8000"; // 🔥 đổi IP máy bạn

  const turnOn = async () => {
    try {
      await axios.get(`${API}/on`);
      setIsOn(true);
    } catch (err) {
      console.log(err);
    }
  };

  const turnOff = async () => {
    try {
      await axios.get(`${API}/off`);
      setIsOn(false);
    } catch (err) {
      console.log(err);
    }
  };

  const toggleSwitch = () => {
    if (isOn) turnOff();
    else turnOn();
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>🏠 Smart Home</Text>

      <View style={styles.card}>
        <Text style={styles.device}>💡 Đèn</Text>

        <Text style={{ color: isOn ? "green" : "red" }}>
          {isOn ? "Đang bật" : "Đang tắt"}
        </Text>

        <Switch value={isOn} onValueChange={toggleSwitch} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f2f2"
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20
  },
  card: {
    width: "80%",
    padding: 20,
    backgroundColor: "#fff",
    borderRadius: 15,
    alignItems: "center",
    elevation: 5
  },
  device: {
    fontSize: 20,
    marginBottom: 10
  }
});