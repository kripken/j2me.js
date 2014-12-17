interface TestInterface {
  public void asd();
}

class SimpleClass {

  private static void bubbleSort(int [] a, int left, int right) {
    for (int i = right; i > 1; i--) {
      for (int j = left; j < i; j++) {
        if(a[j] > a[j + 1]) {
          int temp = a[j];
          a[j] = a[j + 1];
          a[j + 1] = temp;
        }
      }
    }
  }

  public static void main(String[] args) {
    System.out.println("Running...");

    int [] array = new int [1024];

    for (int i = 0; i < array.length; i++) {
      array[i] = array.length - i;
    }

    for (int i = 0; i < 6; i++) {
      for (int j = 0; j < array.length; j++) {
        array[j] = array.length - j;
      }
      SimpleClass.bubbleSort(array, 0, array.length - 1);
    }

    for (int i = 0; i < array.length-1; i++) {
      if (array[i] > array[i+1]) System.out.println("BADDDDDDDDDDDD");
    }

    System.out.println("Done.");
  }
}
